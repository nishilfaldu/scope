import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { endForAgent } from "./approvals";
import { agentFor, hashToken, newAgentToken, ownerId } from "./lib/identity";

export const create = mutation({
  args: { name: v.string() },
  returns: v.object({ id: v.id("agents"), token: v.string() }),
  handler: async (ctx, args) => {
    const owner = await ownerId(ctx),
      name = args.name.trim();
    if (!name || name.length > 100) throw new ConvexError("invalid-input");
    const token = newAgentToken();
    const id = await ctx.db.insert("agents", {
      ownerId: owner,
      name,
      tokenHash: await hashToken(token),
    });
    return { id, token };
  },
});

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("agents"),
      _creationTime: v.number(),
      name: v.string(),
      lastUsedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    const rows = await ctx.db
      .query("agents")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", owner))
      .order("desc")
      .take(100);
    return rows.map(({ _id, _creationTime, name, lastUsedAt }) => ({
      _id,
      _creationTime,
      name,
      lastUsedAt,
    }));
  },
});

export const remove = mutation({
  args: { id: v.id("agents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await ownerId(ctx),
      agent = await ctx.db.get("agents", args.id);
    if (!agent || agent.ownerId !== owner)
      throw new ConvexError("authority-invalid");
    await endForAgent(ctx, agent._id);
    await ctx.db.delete("agents", agent._id);
    return null;
  },
});

export const whoami = query({
  args: { token: v.string() },
  returns: v.object({ name: v.string() }),
  handler: async (ctx, args) => {
    const agent = await agentFor(ctx, args.token);
    return { name: agent.name };
  },
});
