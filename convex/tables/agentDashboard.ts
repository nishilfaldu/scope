import { v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { authenticatedQuery } from "../functions";
import { effectiveSliceStatus } from "../domain/slices";
import { connectionDeadline, sliceHandoff } from "../domain/handoff";
import {
  projectConnectionHandoff,
  activeConnectionForAgent,
  agentAccessRevokedAt,
} from "./agentConnections";

const boardConnection = v.object({
  _id: v.id("agentConnections"),
  _creationTime: v.number(),
  name: v.string(),
  agentId: v.string(),
  status: v.union(
    v.literal("staged"),
    v.literal("active"),
    v.literal("revoked"),
  ),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  revocationReason: v.optional(v.string()),
  handoffStatus: v.optional(v.string()),
  handoffDeadlineAt: v.optional(v.number()),
});

const boardGrant = v.object({
  _id: v.id("slices"),
  name: v.string(),
  status: v.union(
    v.literal("staged"),
    v.literal("active"),
    v.literal("revoked"),
    v.literal("expired"),
  ),
  expiresAt: v.number(),
});

export const list = authenticatedQuery({
  args: { now: v.optional(v.number()) },
  returns: v.array(boardConnection),
  handler: async (ctx, args) => {
    const rows = [
      ...(await ctx.db
        .query("agentConnections")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", ctx.userId).eq("status", "staged"),
        )
        .order("desc")
        .take(100)),
      ...(await ctx.db
        .query("agentConnections")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", ctx.userId).eq("status", "active"),
        )
        .order("desc")
        .take(200)),
      ...(await ctx.db
        .query("agentConnections")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", ctx.userId).eq("status", "revoked"),
        )
        .order("desc")
        .take(100)),
    ];
    const byAgent = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const current = byAgent.get(row.agentId);
      if (
        !current ||
        (row.status === "active" && current.status !== "active") ||
        (row.status === "staged" && current.status === "revoked")
      ) {
        byAgent.set(row.agentId, row);
      }
    }
    const visible = [
      ...rows.filter((row) => row.status === "staged"),
      ...[...byAgent.values()].filter((row) => row.status !== "staged"),
    ];
    return await Promise.all(
      visible.map(async (row) => {
        const invite =
          row.status === "staged"
            ? await ctx.db
                .query("agentConnectionInvites")
                .withIndex("by_agent_connection_id", (q) =>
                  q.eq("agentConnectionId", row._id),
                )
                .unique()
            : null;
        const handoff = invite
          ? await projectConnectionHandoff(
              ctx,
              invite,
              row,
              args.now ?? Date.now(),
            )
          : null;
        return {
          _id: row._id,
          _creationTime: row._creationTime,
          name: row.name,
          agentId: row.agentId,
          status: row.status,
          lastUsedAt: row.lastUsedAt,
          revokedAt: row.revokedAt,
          revocationReason: handoff?.reason ?? row.revocationReason,
          handoffStatus: handoff?.handoffStatus,
          handoffDeadlineAt: invite
            ? connectionDeadline(invite)?.at
            : undefined,
        };
      }),
    );
  },
});

// The owner UI pages active identities directly from an indexed status range.
export const activePage = authenticatedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(boardConnection),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("agentConnections")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", ctx.userId).eq("status", "active"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((row) => ({
        _id: row._id,
        _creationTime: row._creationTime,
        name: row.name,
        agentId: row.agentId,
        status: "active" as const,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
        revocationReason: row.revocationReason,
      })),
    };
  },
});

export const grantsPage = authenticatedQuery({
  args: {
    agentConnectionId: v.id("agentConnections"),
    now: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(boardGrant),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agentConnections", args.agentConnectionId);
    if (!agent || agent.userId !== ctx.userId || agent.status === "staged") {
      throw new Error("Agent connection not found");
    }
    const page = await ctx.db
      .query("slices")
      .withIndex("by_agentId", (q) => q.eq("agentId", agent.agentId))
      .order("desc")
      .paginate(args.paginationOpts);
    const parent = await activeConnectionForAgent(ctx, agent.agentId);
    const parentRevokedAt = parent
      ? undefined
      : await agentAccessRevokedAt(ctx, agent.agentId);
    const now = args.now ?? Date.now();
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (slice) => {
          const request = await ctx.db
            .query("sliceRequests")
            .withIndex("by_createdSliceId", (q) =>
              q.eq("createdSliceId", slice._id),
            )
            .unique();
          return {
            _id: slice._id,
            name: slice.name,
            expiresAt: slice.expiresAt,
            status: request
              ? sliceHandoff(request, slice, !!parent, now, parentRevokedAt)
                  .resourceStatus!
              : parent
                ? effectiveSliceStatus(slice, now)
                : ("revoked" as const),
          };
        }),
      ),
    };
  },
});
