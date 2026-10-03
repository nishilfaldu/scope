import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { selectedConnection } from "../tables/connections/helpers";
import { connectReferenceValidator } from "./contracts";

export const get = internalQuery({
  args: { userId: v.id("users"), connectionId: v.id("connections") },
  returns: v.union(
    v.object({
      connect: connectReferenceValidator,
      providerUserId: v.string(),
      grantVersion: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await selectedConnection(
      ctx,
      args.userId,
      "slack",
      args.connectionId,
    );
    return row
      ? {
          connect: row.connect,
          providerUserId: row.providerUserId,
          grantVersion: row.grantVersion,
        }
      : null;
  },
});
export const save = internalMutation({
  args: {
    userId: v.id("users"),
    connect: connectReferenceValidator,
    login: v.string(),
    providerUserId: v.string(),
    grantedScopes: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!args.providerUserId.trim())
      throw new Error("Provider account ID is required");
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_user_app_providerUserId", (q) =>
        q
          .eq("userId", args.userId)
          .eq("app", "slack")
          .eq("providerUserId", args.providerUserId),
      )
      .unique();
    const doc = {
      ...args,
      app: "slack" as const,
      backend: "vercel-connect" as const,
      grantVersion: (existing?.grantVersion ?? 0) + 1,
    };
    if (existing) await ctx.db.replace("connections", existing._id, doc);
    else await ctx.db.insert("connections", doc);
    return null;
  },
});
