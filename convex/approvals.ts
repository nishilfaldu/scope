import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { connectorFor } from "../shared/connectors";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { agentFor, ownerId } from "./lib/identity";

const decisionWindowMs = 30 * 60_000;

async function view(ctx: QueryCtx, row: Doc<"approvals">) {
  const [agent, account] = await Promise.all([
    ctx.db.get("agents", row.agentId),
    row.accountId ? ctx.db.get("accounts", row.accountId) : null,
  ]);
  return {
    ...row,
    agentName: agent?.name ?? "Deleted agent",
    accountLabel: account?.label,
  };
}

async function owned(ctx: QueryCtx, id: Id<"approvals">) {
  const owner = await ownerId(ctx),
    row = await ctx.db.get("approvals", id);
  if (!row || row.ownerId !== owner) throw new ConvexError("authority-invalid");
  return row;
}

async function close(
  ctx: MutationCtx,
  rows: Doc<"approvals">[],
  status: "ended" | "expired",
) {
  const now = Date.now();
  for (const row of rows)
    await ctx.db.patch("approvals", row._id, {
      status,
      endedAt: status === "expired" ? row.expiresAt : now,
    });
}

export async function endForAgent(ctx: MutationCtx, agentId: Id<"agents">) {
  for (const status of ["pending", "approved"] as const)
    await close(
      ctx,
      await ctx.db
        .query("approvals")
        .withIndex("by_agentId_and_status_and_providerId", (q) =>
          q.eq("agentId", agentId).eq("status", status),
        )
        .take(100),
      "ended",
    );
}

export async function endForAccount(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
) {
  await close(
    ctx,
    await ctx.db
      .query("approvals")
      .withIndex("by_accountId_and_status", (q) =>
        q.eq("accountId", accountId).eq("status", "approved"),
      )
      .take(100),
    "ended",
  );
}

// Agent-facing. The agent token is the only authority.

export const request = mutation({
  args: { token: v.string(), providerId: v.string(), reason: v.string() },
  returns: v.object({ id: v.id("approvals"), status: v.string() }),
  handler: async (ctx, args) => {
    const agent = await agentFor(ctx, args.token),
      reason = args.reason.trim();
    if (!connectorFor(args.providerId) || !reason || reason.length > 1000)
      throw new ConvexError("invalid-input");
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_ownerId_and_providerId", (q) =>
        q.eq("ownerId", agent.ownerId).eq("providerId", args.providerId),
      )
      .first();
    if (!account) throw new ConvexError("no-account");
    const now = Date.now();
    for (const status of ["approved", "pending"] as const) {
      const open = await ctx.db
        .query("approvals")
        .withIndex("by_agentId_and_status_and_providerId", (q) =>
          q
            .eq("agentId", agent._id)
            .eq("status", status)
            .eq("providerId", args.providerId),
        )
        .first();
      if (!open) continue;
      if (open.expiresAt > now) return { id: open._id, status };
      await close(ctx, [open], "expired");
    }
    const expiresAt = now + decisionWindowMs;
    const id = await ctx.db.insert("approvals", {
      ownerId: agent.ownerId,
      agentId: agent._id,
      providerId: args.providerId,
      reason,
      status: "pending",
      expiresAt,
      collections: 0,
    });
    await ctx.db.patch("agents", agent._id, { lastUsedAt: now });
    await ctx.scheduler.runAt(expiresAt, internal.approvals.expire, { id });
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", agent.ownerId))
      .take(10);
    for (const sub of subscriptions)
      await ctx.scheduler.runAfter(0, internal.notificationDelivery.deliver, {
        approvalId: id,
        subscriptionId: sub._id,
      });
    return { id, status: "pending" };
  },
});

export const status = query({
  args: { token: v.string(), id: v.id("approvals") },
  returns: v.object({ status: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const agent = await agentFor(ctx, args.token),
      row = await ctx.db.get("approvals", args.id);
    if (!row || row.agentId !== agent._id)
      throw new ConvexError("authority-invalid");
    return { status: row.status, expiresAt: row.expiresAt };
  },
});

export const claim = mutation({
  args: { token: v.string(), id: v.id("approvals") },
  returns: v.object({
    ownerId: v.string(),
    providerId: v.string(),
    connectorId: v.string(),
    installationId: v.optional(v.string()),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const agent = await agentFor(ctx, args.token),
      row = await ctx.db.get("approvals", args.id),
      now = Date.now();
    if (
      !row ||
      row.agentId !== agent._id ||
      row.status !== "approved" ||
      row.expiresAt <= now ||
      !row.accountId
    )
      throw new ConvexError("authority-invalid");
    const account = await ctx.db.get("accounts", row.accountId);
    if (!account || account.ownerId !== row.ownerId)
      throw new ConvexError("authority-invalid");
    await ctx.db.patch("approvals", row._id, {
      collections: row.collections + 1,
      lastCollectedAt: now,
    });
    await ctx.db.patch("agents", agent._id, { lastUsedAt: now });
    return {
      ownerId: row.ownerId,
      providerId: row.providerId,
      connectorId: account.connectorId,
      installationId: account.installationId,
      expiresAt: row.expiresAt,
    };
  },
});

// Owner-facing.

const approvalView = v.object({
  _id: v.id("approvals"),
  _creationTime: v.number(),
  ownerId: v.string(),
  agentId: v.id("agents"),
  providerId: v.string(),
  accountId: v.optional(v.id("accounts")),
  reason: v.string(),
  status: v.string(),
  expiresAt: v.number(),
  decidedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  collections: v.number(),
  lastCollectedAt: v.optional(v.number()),
  agentName: v.string(),
  accountLabel: v.optional(v.string()),
});

export const open = query({
  args: {},
  returns: v.object({
    pending: v.array(approvalView),
    approved: v.array(approvalView),
  }),
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    const load = async (status: "pending" | "approved") =>
      Promise.all(
        (
          await ctx.db
            .query("approvals")
            .withIndex("by_ownerId_and_status", (q) =>
              q.eq("ownerId", owner).eq("status", status),
            )
            .order("desc")
            .take(50)
        ).map((row) => view(ctx, row)),
      );
    const [pending, approved] = await Promise.all([
      load("pending"),
      load("approved"),
    ]);
    return { pending, approved };
  },
});

export const history = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(approvalView),
  handler: async (ctx, args) => {
    const owner = await ownerId(ctx);
    const page = await ctx.db
      .query("approvals")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", owner))
      .order("desc")
      // Skips only open rows, which expire within an hour.
      // eslint-disable-next-line @convex-dev/no-filter-in-query
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "pending"),
          q.neq(q.field("status"), "approved"),
        ),
      )
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(page.page.map((row) => view(ctx, row))),
    };
  },
});

export const pendingCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_ownerId_and_status", (q) =>
        q.eq("ownerId", owner).eq("status", "pending"),
      )
      .take(100);
    return rows.length;
  },
});

export async function onlyAccount(
  ctx: QueryCtx,
  ownerId: string,
  providerId: string,
) {
  const rows = await ctx.db
    .query("accounts")
    .withIndex("by_ownerId_and_providerId", (q) =>
      q.eq("ownerId", ownerId).eq("providerId", providerId),
    )
    .take(2);
  return rows.length === 1 ? rows[0] : null;
}

export const approve = mutation({
  args: {
    id: v.id("approvals"),
    // Without it, the owner must have exactly one account for the provider.
    accountId: v.optional(v.id("accounts")),
    minutes: v.union(v.literal(15), v.literal(30), v.literal(60)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.id),
      account = args.accountId
        ? await ctx.db.get("accounts", args.accountId)
        : await onlyAccount(ctx, row.ownerId, row.providerId),
      now = Date.now();
    if (
      row.status !== "pending" ||
      row.expiresAt <= now ||
      !account ||
      account.ownerId !== row.ownerId ||
      account.providerId !== row.providerId
    )
      throw new ConvexError("authority-invalid");
    const expiresAt = now + args.minutes * 60_000;
    await ctx.db.patch("approvals", row._id, {
      status: "approved",
      accountId: account._id,
      decidedAt: now,
      expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.approvals.expire, {
      id: row._id,
    });
    return null;
  },
});

export const deny = mutation({
  args: { id: v.id("approvals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.id);
    if (row.status !== "pending") throw new ConvexError("authority-invalid");
    await ctx.db.patch("approvals", row._id, {
      status: "denied",
      decidedAt: Date.now(),
    });
    return null;
  },
});

export const end = mutation({
  args: { id: v.id("approvals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.id);
    if (row.status === "approved") await close(ctx, [row], "ended");
    return null;
  },
});

export const expire = internalMutation({
  args: { id: v.id("approvals") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("approvals", id);
    if (
      row &&
      (row.status === "pending" || row.status === "approved") &&
      row.expiresAt <= Date.now()
    )
      await close(ctx, [row], "expired");
    return null;
  },
});
