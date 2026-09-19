import { v } from "convex/values";
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
  slices: v.array(
    v.object({
      _id: v.id("slices"),
      name: v.string(),
      status: v.union(
        v.literal("active"),
        v.literal("revoked"),
        v.literal("expired"),
      ),
      expiresAt: v.number(),
    }),
  ),
});

export const list = authenticatedQuery({
  args: {},
  returns: v.array(boardConnection),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("agentConnections")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .order("desc")
      .take(100);
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
    return await Promise.all(
      [...byAgent.values()].map(async (row) => {
        const slices = await ctx.db
          .query("slices")
          .withIndex("by_agentId", (q) => q.eq("agentId", row.agentId))
          .collect();
        return {
          _id: row._id,
          _creationTime: row._creationTime,
          name: row.name,
          agentId: row.agentId,
          status: row.status,
          lastUsedAt: row.lastUsedAt,
          revokedAt: row.revokedAt,
          slices: slices.map((slice) => ({
            _id: slice._id,
            name: slice.name,
            status:
              row.status === "revoked"
                ? ("revoked" as const)
                : effectiveSliceStatus(slice),
            expiresAt: slice.expiresAt,
          })),
        };
      }),
    );
  },
});
