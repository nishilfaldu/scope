import { v } from "convex/values";
import { query, mutation, env } from "./_generated/server";
import {
  actor,
  clientActor,
  collectorEligible,
  owner,
  verifiedActor,
} from "./scope";

const view = v.object({
  _id: v.id("clientConnections"),
  name: v.string(),
  collectorEligible: v.boolean(),
  stoppedAt: v.optional(v.number()),
});
export const ensure = mutation({
  args: actor.fields,
  returns: view,
  handler: async (ctx, args) => {
    await verifiedActor(ctx, args);
    const old = await ctx.db
      .query("clientConnections")
      .withIndex("by_issuer_and_subject_and_clientId_and_consentId", (q) =>
        q
          .eq("issuer", args.issuer)
          .eq("subject", args.subject)
          .eq("clientId", args.clientId)
          .eq("consentId", args.consentId),
      )
      .unique();
    if (old) {
      if (old.ownerId !== args.userId || old.stoppedAt !== undefined)
        throw new Error("Connection unavailable");
      return {
        _id: old._id,
        name: old.name,
        collectorEligible: collectorEligible(old.clientId),
      };
    }
    const eligible = collectorEligible(args.clientId),
      name = eligible ? "Local helper" : "MCP connection";
    const id = await ctx.db.insert("clientConnections", {
      ownerId: args.userId,
      issuer: args.issuer,
      subject: args.subject,
      clientId: args.clientId,
      consentId: args.consentId,
      name,
    });
    return { _id: id, name, collectorEligible: eligible };
  },
});
export const forOwner = query({
  args: {},
  returns: v.array(view),
  handler: async (ctx) => {
    const ownerId = await owner(ctx);
    const rows = await ctx.db
      .query("clientConnections")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(100);
    return rows.map((r) => ({
      _id: r._id,
      name: r.name,
      collectorEligible: collectorEligible(r.clientId),
      stoppedAt: r.stoppedAt,
    }));
  },
});
export const collectors = query({
  args: actor.fields,
  returns: v.array(
    v.object({ id: v.id("clientConnections"), name: v.string() }),
  ),
  handler: async (ctx, args) => {
    await clientActor(ctx, args);
    const helperId = env.SCOPE_HELPER_CLIENT_ID;
    if (!helperId) return [];
    const rows = await ctx.db
      .query("clientConnections")
      .withIndex("by_ownerId_and_clientId_and_stoppedAt", (q) =>
        q
          .eq("ownerId", args.userId)
          .eq("clientId", helperId)
          .eq("stoppedAt", undefined),
      )
      .take(100);
    return rows.map((r) => ({ id: r._id, name: r.name }));
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
      r = await ctx.db.get("clientConnections", args.id);
    if (!r || r.ownerId !== ownerId) throw new Error("Connection unavailable");
    const name = args.name?.trim();
    if (name !== undefined && (!name || name.length > 80))
      throw new Error("Invalid name");
    await ctx.db.patch("clientConnections", r._id, {
      name: name ?? r.name,
      stoppedAt: args.stop ? (r.stoppedAt ?? Date.now()) : r.stoppedAt,
    });
    return null;
  },
});
