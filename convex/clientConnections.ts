import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { actor, owner, verifiedActor } from "./scope";

const view = v.object({
  _id: v.id("clientConnections"),
  name: v.string(),
  stoppedAt: v.optional(v.number()),
});
export const ensure = mutation({
  args: actor.fields,
  returns: view,
  handler: async (ctx, args) => {
    await verifiedActor(ctx, args);
    const old = await ctx.db
      .query("clientConnections")
      .withIndex("by_issuer_and_subject_and_clientId_and_sessionId", (q) =>
        q
          .eq("issuer", args.issuer)
          .eq("subject", args.subject)
          .eq("clientId", args.clientId)
          .eq("sessionId", args.sessionId),
      )
      .unique();
    if (old) {
      if (old.ownerId !== args.subject || old.stoppedAt !== undefined)
        throw new Error("Connection unavailable");
      return { _id: old._id, name: old.name };
    }
    const name = "CLI connection";
    const id = await ctx.db.insert("clientConnections", {
      ownerId: args.subject,
      issuer: args.issuer,
      subject: args.subject,
      clientId: args.clientId,
      sessionId: args.sessionId,
      name,
    });
    return { _id: id, name };
  },
});
export const forOwner = query({
  args: {},
  returns: v.array(view),
  handler: async (ctx) => {
    const ownerId = await owner(ctx),
      rows = await ctx.db
        .query("clientConnections")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .order("desc")
        .take(100);
    return rows.map((r) => ({
      _id: r._id,
      name: r.name,
      stoppedAt: r.stoppedAt,
    }));
  },
});
export const update = mutation({
  args: {
    id: v.id("clientConnections"),
    name: v.optional(v.string()),
    stop: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await owner(ctx),
      row = await ctx.db.get("clientConnections", args.id);
    if (!row || row.ownerId !== ownerId)
      throw new Error("Connection unavailable");
    const name = args.name?.trim();
    if (name !== undefined && (!name || name.length > 80))
      throw new Error("Invalid name");
    await ctx.db.patch("clientConnections", row._id, {
      name: name ?? row.name,
      stoppedAt: args.stop ? (row.stoppedAt ?? Date.now()) : row.stoppedAt,
    });
    return null;
  },
});
