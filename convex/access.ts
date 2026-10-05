import { omit } from "convex-helpers";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal, components } from "./_generated/api";
import type { Doc, DataModel } from "./_generated/dataModel";
import { TableAggregate } from "@convex-dev/aggregate";
import {
  actor,
  owner,
  verifiedActor,
  sameScopes,
  section,
  connectReference,
} from "./scope";
import schema from "./schema";
import { hashesEqual, randomSecret } from "./lib/secrets";
import { retrier } from "./notifications";

export const counts = new TableAggregate<{
  Namespace: string;
  Key: string;
  DataModel: DataModel;
  TableName: "accessApprovals";
}>(components.accessCounts, {
  namespace: (r) => r.ownerId,
  sortKey: (r) => r.section,
});
const view = schema
  .doc("accessApprovals")
  .omit("receiptProof")
  .extend({ accountAvailable: v.boolean() });
async function accountFor(
  ctx: QueryCtx | MutationCtx,
  r: Doc<"accessApprovals">,
) {
  const a = await ctx.db.get("connectedAccounts", r.accountId);
  return a &&
    a.ownerId === r.ownerId &&
    a.state === "active" &&
    a.grantVersion === r.grantVersion &&
    a.providerId === r.providerId
    ? a
    : null;
}
function sameSession(r: Doc<"accessApprovals">, a: typeof actor.type) {
  return (
    r.ownerId === a.subject &&
    r.issuer === a.issuer &&
    r.clientId === a.clientId &&
    r.sessionId === a.sessionId
  );
}
async function checked(
  ctx: QueryCtx | MutationCtx,
  a: typeof actor.type,
  id: Doc<"accessApprovals">["_id"],
) {
  await verifiedActor(ctx, a);
  const r = await ctx.db.get("accessApprovals", id);
  if (!r || !sameSession(r, a)) throw new Error("Access unavailable");
  return r;
}
async function present(ctx: QueryCtx, r: Doc<"accessApprovals">) {
  const safe = omit(r, ["receiptProof"]);
  return { ...safe, accountAvailable: !!(await accountFor(ctx, r)) };
}
export async function updateAccess(
  ctx: MutationCtx,
  r: Doc<"accessApprovals">,
  patch: Partial<Doc<"accessApprovals">>,
) {
  await ctx.db.patch("accessApprovals", r._id, patch);
  const next = (await ctx.db.get("accessApprovals", r._id))!;
  if (r.section !== next.section) await counts.replace(ctx, r, next);
  return next;
}
export const request = mutation({
  args: {
    ...actor.fields,
    accountId: v.id("connectedAccounts"),
    agentName: v.string(),
    reason: v.string(),
  },
  returns: v.object({
    id: v.id("accessApprovals"),
    status: v.string(),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await verifiedActor(ctx, args);
    if (
      !args.agentName.trim() ||
      args.agentName.length > 100 ||
      !args.reason.trim() ||
      args.reason.length > 1000
    )
      throw new Error("Invalid input");
    const a = await ctx.db.get("connectedAccounts", args.accountId);
    if (!a || a.ownerId !== args.subject || a.state !== "active")
      throw new Error("Account unavailable");
    for (const status of ["active", "pending"] as const) {
      const old = await ctx.db
        .query("accessApprovals")
        .withIndex("by_actor_and_account_and_grant_and_status", (q) =>
          q
            .eq("ownerId", args.subject)
            .eq("issuer", args.issuer)
            .eq("clientId", args.clientId)
            .eq("sessionId", args.sessionId)
            .eq("accountId", a._id)
            .eq("grantVersion", a.grantVersion)
            .eq("status", status),
        )
        .first();
      if (old) {
        if ((status === "active" ? old.until! : old.waitingUntil) > Date.now())
          return { id: old._id, status: old.status, created: false };
        await updateAccess(ctx, old, {
          status: "expired",
          section: "history",
          endedAt: status === "active" ? old.until : old.waitingUntil,
          endReason: "expired",
        });
      }
    }
    const waitingUntil = Date.now() + 30 * 60_000;
    const id = await ctx.db.insert("accessApprovals", {
      ownerId: args.subject,
      issuer: args.issuer,
      clientId: args.clientId,
      sessionId: args.sessionId,
      accountId: a._id,
      grantVersion: a.grantVersion,
      providerId: a.providerId,
      snapshot: {
        accountLabel: a.label,
        providerName: a.providerName,
        agentName: args.agentName.trim(),
      },
      reason: args.reason.trim(),
      status: "pending",
      section: "pending",
      waitingUntil,
      collectionCount: 0,
    });
    await counts.insert(ctx, (await ctx.db.get("accessApprovals", id))!);
    await ctx.scheduler.runAt(waitingUntil, internal.access.expire, {
      id,
      phase: "pending",
      deadline: waitingUntil,
    });
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.subject))
      .take(10);
    for (const sub of subscriptions)
      await retrier.run(ctx, internal.notificationDelivery.deliver, {
        requestId: id,
        subscriptionId: sub._id,
      });
    return { id, status: "pending", created: true };
  },
});
export const forOwner = query({
  args: { section, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(view),
  handler: async (ctx, args) => {
    const id = await owner(ctx);
    const page = await ctx.db
      .query("accessApprovals")
      .withIndex("by_ownerId_and_section", (q) =>
        q.eq("ownerId", id).eq("section", args.section),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(page.page.map((r) => present(ctx, r))),
    };
  },
});
export const pendingCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) =>
    counts.count(ctx, {
      namespace: await owner(ctx),
      bounds: {
        lower: { key: "pending", inclusive: true },
        upper: { key: "pending", inclusive: true },
      },
    }),
});
export const requestForOwner = query({
  args: { reference: v.string() },
  returns: v.union(v.null(), view),
  handler: async (ctx, { reference }) => {
    const id = ctx.db.normalizeId("accessApprovals", reference),
      ownerId = await owner(ctx);
    if (!id) return null;
    const r = await ctx.db.get("accessApprovals", id);
    return r?.ownerId === ownerId ? present(ctx, r) : null;
  },
});
export const decide = mutation({
  args: {
    id: v.id("accessApprovals"),
    approve: v.boolean(),
    minutes: v.union(v.literal(15), v.literal(30), v.literal(60)),
  },
  returns: v.null(),
  handler: async (ctx, { id, approve, minutes }) => {
    const ownerId = await owner(ctx),
      r = await ctx.db.get("accessApprovals", id);
    if (
      !r ||
      r.ownerId !== ownerId ||
      r.status !== "pending" ||
      r.waitingUntil <= Date.now() ||
      !(await accountFor(ctx, r))
    )
      throw new Error("Access unavailable");
    const now = Date.now();
    if (approve) {
      const until = now + minutes * 60_000;
      await updateAccess(ctx, r, {
        status: "active",
        section: "active",
        approvedAt: now,
        until,
        receiptProof: randomSecret("receipt_"),
      });
      await ctx.scheduler.runAt(until, internal.access.expire, {
        id,
        phase: "active",
        deadline: until,
      });
    } else
      await updateAccess(ctx, r, {
        status: "denied",
        section: "history",
        deniedAt: now,
      });
    return null;
  },
});
export const end = mutation({
  args: { id: v.id("accessApprovals") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const ownerId = await owner(ctx),
      r = await ctx.db.get("accessApprovals", id);
    if (!r || r.ownerId !== ownerId) throw new Error("Access unavailable");
    if (r.status === "active")
      await updateAccess(ctx, r, {
        status: "ended",
        section: "history",
        endedAt: Date.now(),
        endReason: "owner",
      });
    return null;
  },
});
export const expire = internalMutation({
  args: {
    id: v.id("accessApprovals"),
    phase: v.union(v.literal("pending"), v.literal("active")),
    deadline: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { id, phase, deadline }) => {
    const r = await ctx.db.get("accessApprovals", id);
    if (
      r &&
      r.status === phase &&
      (phase === "pending" ? r.waitingUntil : r.until) === deadline &&
      deadline <= Date.now()
    )
      await updateAccess(ctx, r, {
        status: "expired",
        section: "history",
        endedAt: deadline,
        endReason: "expired",
      });
    return null;
  },
});
const clientView = view
  .omit("accountAvailable", "status")
  .extend({ status: v.string() });
export const status = query({
  args: { ...actor.fields, id: v.id("accessApprovals") },
  returns: clientView,
  handler: async (ctx, args) => {
    const r = await checked(ctx, args, args.id),
      safe = omit(r, ["receiptProof"]);
    return {
      ...safe,
      status: !(await accountFor(ctx, r))
        ? "unavailable"
        : (r.status === "pending" && r.waitingUntil <= Date.now()) ||
            (r.status === "active" && r.until! <= Date.now())
          ? "expired"
          : r.status,
    };
  },
});
const acquisition = v.object({
  status: v.literal("acquire"),
  accountId: v.id("connectedAccounts"),
  providerId: v.string(),
  grantVersion: v.number(),
  account: connectReference.extend({ scopes: v.array(v.string()) }),
});
export const preflight = query({
  args: { ...actor.fields, id: v.id("accessApprovals"), now: v.number() },
  returns: v.union(v.object({ status: v.string() }), acquisition),
  handler: async (ctx, args) => {
    const r = await checked(ctx, args, args.id),
      a = await accountFor(ctx, r);
    if (!a) return { status: "unavailable" };
    if (r.status !== "active") return { status: r.status };
    if (!Number.isFinite(args.now) || r.until! <= args.now)
      return { status: "expired" };
    return {
      status: "acquire" as const,
      accountId: a._id,
      providerId: a.providerId,
      grantVersion: a.grantVersion,
      account: {
        ...a.connect,
        scopes: a.requestedScopes,
      },
    };
  },
});
export const authorizeCollection = mutation({
  args: {
    ...actor.fields,
    id: v.id("accessApprovals"),
    grantVersion: v.number(),
    connect: connectReference.extend({ scopes: v.array(v.string()) }),
  },
  returns: v.object({ until: v.number(), receiptProof: v.string() }),
  handler: async (ctx, args) => {
    const r = await checked(ctx, args, args.id),
      a = await accountFor(ctx, r);
    if (
      r.status !== "active" ||
      r.until! <= Date.now() ||
      r.grantVersion !== args.grantVersion ||
      !a ||
      a.connect.connectorId !== args.connect.connectorId ||
      a.connect.subjectId !== args.connect.subjectId ||
      a.connect.issuer !== args.connect.issuer ||
      a.connect.installationId !== args.connect.installationId ||
      !sameScopes(a.requestedScopes, args.connect.scopes)
    )
      throw new Error("Access unavailable");
    const now = Date.now();
    await ctx.db.patch("accessApprovals", r._id, {
      firstCollectedAt: r.firstCollectedAt ?? now,
      lastCollectedAt: now,
      collectionCount: r.collectionCount + 1,
    });
    return { until: r.until!, receiptProof: r.receiptProof! };
  },
});
export const acknowledge = mutation({
  args: {
    ...actor.fields,
    id: v.id("accessApprovals"),
    receiptProof: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const r = await checked(ctx, args, args.id);
    if (
      !r.receiptProof ||
      !hashesEqual(r.receiptProof, args.receiptProof) ||
      r.firstCollectedAt === undefined
    )
      throw new Error("Receipt unavailable");
    await ctx.db.patch("accessApprovals", r._id, {
      receivedAt: r.receivedAt ?? Date.now(),
    });
    return null;
  },
});
export const closeAccount = internalMutation({
  args: { id: v.id("connectedAccounts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get("connectedAccounts", id);
    if (!a || a.state === "active") return null;
    let more = false;
    for (const group of ["pending", "active"] as const) {
      const rows = await ctx.db
        .query("accessApprovals")
        .withIndex("by_accountId_and_section", (q) =>
          q.eq("accountId", id).eq("section", group),
        )
        .take(100);
      for (const r of rows)
        await updateAccess(ctx, r, {
          status: "ended",
          section: "history",
          endedAt: a.blockedAt ?? Date.now(),
          endReason: "account-disconnected",
        });
      more ||= rows.length === 100;
    }
    if (more)
      await ctx.scheduler.runAfter(0, internal.access.closeAccount, { id });
    return null;
  },
});
