import { v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { authenticatedQuery } from "../functions";
import { effectiveSliceStatus } from "../domain/slices";

const boardConnection = v.object({
  _id: v.id("agentConnections"),
  _creationTime: v.number(),
  name: v.string(),
  agentId: v.string(),
  status: v.union(v.literal("active"), v.literal("revoked")),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
});

const boardGrant = v.object({
  _id: v.id("slices"),
  name: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("revoked"),
    v.literal("expired"),
  ),
  expiresAt: v.number(),
});

export const list = authenticatedQuery({
  args: {},
  returns: v.array(boardConnection),
  handler: async (ctx) => {
    const rows = [
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
    type VisibleConnection = (typeof rows)[number] & {
      status: "active" | "revoked";
    };
    const byAgent = new Map<string, VisibleConnection>();
    for (const row of rows) {
      if (row.status === "staged") continue;
      const current = byAgent.get(row.agentId);
      if (
        !current ||
        (row.status === "active" && current.status !== "active")
      ) {
        byAgent.set(row.agentId, row as VisibleConnection);
      }
    }
    return [...byAgent.values()].map((row) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      name: row.name,
      agentId: row.agentId,
      status: row.status,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
    }));
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
      })),
    };
  },
});

export const grantsPage = authenticatedQuery({
  args: {
    agentConnectionId: v.id("agentConnections"),
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
    return {
      ...page,
      page: page.page.map((slice) => ({
        _id: slice._id,
        name: slice.name,
        status:
          agent.status === "revoked"
            ? ("revoked" as const)
            : effectiveSliceStatus(slice),
        expiresAt: slice.expiresAt,
      })),
    };
  },
});
