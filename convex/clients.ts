import { ConvexError, v } from "convex/values";
import { defaultRule, toolFor } from "../shared/tools";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { endForClient } from "./approvals";
import { ownerId } from "./lib/identity";
import { rule } from "./schema";

async function owned(ctx: QueryCtx, id: Id<"clients">) {
  const owner = await ownerId(ctx),
    row = await ctx.db.get("clients", id);
  if (!row || row.ownerId !== owner) throw new ConvexError("authority-invalid");
  return row;
}

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("clients"),
      _creationTime: v.number(),
      name: v.string(),
      clientKey: v.string(),
      revokedAt: v.optional(v.number()),
      lastUsedAt: v.optional(v.number()),
      rules: v.record(v.string(), rule),
    }),
  ),
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    const rows = await ctx.db
      .query("clients")
      .withIndex("by_ownerId_and_clientKey", (q) => q.eq("ownerId", owner))
      .take(50);
    return Promise.all(
      rows.map(async (row) => {
        const overrides = await ctx.db
          .query("rules")
          .withIndex("by_clientId_and_tool", (q) => q.eq("clientId", row._id))
          .take(200);
        return {
          _id: row._id,
          _creationTime: row._creationTime,
          name: row.name,
          clientKey: row.clientKey,
          revokedAt: row.revokedAt,
          lastUsedAt: row.lastUsedAt,
          rules: Object.fromEntries(
            overrides
              .filter((r) => toolFor(r.tool))
              .map((r) => [r.tool, r.rule]),
          ),
        };
      }),
    );
  },
});

export const setRule = mutation({
  args: { id: v.id("clients"), tool: v.string(), rule },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await owned(ctx, args.id),
      tool = toolFor(args.tool);
    if (!tool) throw new ConvexError("invalid-input");
    const existing = await ctx.db
      .query("rules")
      .withIndex("by_clientId_and_tool", (q) =>
        q.eq("clientId", client._id).eq("tool", tool.name),
      )
      .unique();
    if (args.rule === defaultRule(tool)) {
      if (existing) await ctx.db.delete("rules", existing._id);
    } else if (existing)
      await ctx.db.patch("rules", existing._id, { rule: args.rule });
    else
      await ctx.db.insert("rules", {
        clientId: client._id,
        tool: tool.name,
        rule: args.rule,
      });
    return null;
  },
});

export const revoke = mutation({
  args: { id: v.id("clients") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await owned(ctx, args.id);
    await endForClient(ctx, client._id);
    await ctx.db.patch("clients", client._id, { revokedAt: Date.now() });
    return null;
  },
});

export const restore = mutation({
  args: { id: v.id("clients") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await owned(ctx, args.id);
    await ctx.db.patch("clients", client._id, { revokedAt: undefined });
    return null;
  },
});
