import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { ownerId } from "./lib/identity";

const decisionWindowMs = 30 * 60_000,
  onceWindowMs = 10 * 60_000;

export async function requesterName(ctx: QueryCtx, row: Doc<"approvals">) {
  return (await ctx.db.get("clients", row.clientId))?.name ?? "Removed app";
}

async function view(ctx: QueryCtx, row: Doc<"approvals">) {
  const [appName, account] = await Promise.all([
    requesterName(ctx, row),
    row.accountId ? ctx.db.get("accounts", row.accountId) : null,
  ]);
  return { ...row, appName, accountLabel: account?.label };
}

// Creates a pending request, schedules its expiry and notifies every device.
export async function openPending(
  ctx: MutationCtx,
  fields: Pick<
    Doc<"approvals">,
    "ownerId" | "clientId" | "tool" | "argsHash" | "providerId" | "reason"
  >,
) {
  const expiresAt = Date.now() + decisionWindowMs;
  const id = await ctx.db.insert("approvals", {
    ...fields,
    status: "pending",
    expiresAt,
    collections: 0,
  });
  await ctx.scheduler.runAt(expiresAt, internal.approvals.expire, { id });
  const subscriptions = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", fields.ownerId))
    .take(10);
  for (const sub of subscriptions)
    await ctx.scheduler.runAfter(0, internal.notificationDelivery.deliver, {
      approvalId: id,
      subscriptionId: sub._id,
    });
  return id;
}

// Counts one use of an approval. A once approval ends after its use.
export async function spendApproval(ctx: MutationCtx, row: Doc<"approvals">) {
  const now = Date.now();
  await ctx.db.patch("approvals", row._id, {
    collections: row.collections + 1,
    lastCollectedAt: now,
    ...(row.once && { status: "ended" as const, endedAt: now }),
  });
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

export async function endForClient(ctx: MutationCtx, clientId: Id<"clients">) {
  for (const status of ["pending", "approved"] as const)
    await close(
      ctx,
      await ctx.db
        .query("approvals")
        .withIndex("by_clientId_and_status_and_tool", (q) =>
          q.eq("clientId", clientId).eq("status", status),
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

// Owner-facing.

const approvalView = v.object({
  _id: v.id("approvals"),
  _creationTime: v.number(),
  ownerId: v.string(),
  clientId: v.id("clients"),
  tool: v.string(),
  once: v.optional(v.boolean()),
  argsHash: v.optional(v.string()),
  providerId: v.string(),
  accountId: v.optional(v.id("accounts")),
  reason: v.string(),
  status: v.string(),
  expiresAt: v.number(),
  decidedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  collections: v.number(),
  lastCollectedAt: v.optional(v.number()),
  appName: v.string(),
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
    // 0 approves once: one call with the same arguments.
    minutes: v.union(v.literal(0), v.literal(15), v.literal(30), v.literal(60)),
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
    const expiresAt =
      now + (args.minutes ? args.minutes * 60_000 : onceWindowMs);
    await ctx.db.patch("approvals", row._id, {
      status: "approved",
      accountId: account._id,
      decidedAt: now,
      expiresAt,
      once: args.minutes === 0,
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
