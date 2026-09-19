import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation } from "../../_generated/server";
import { authenticatedMutation } from "../../functions";
import { appValidator } from "../../domain/apps";
import {
  bindingForConnection,
  createSlice,
  effectiveStatus,
  MAX_SLICE_NAME,
  MAX_TTL_MS,
  validatedBindings,
  sliceBySecret,
} from "./helpers";
import { selectedConnection } from "../connections/helpers";
import { randomSecret, sha256Hex } from "../../lib/secrets";

export { MAX_SLICE_NAME, MAX_TTL_MS };

const mintPolicyValidator = v.union(v.literal("auto"), v.literal("approve"));
const bindingValidator = v.object({
  app: appValidator,
  connectionId: v.id("connections"),
});

// Internal fixture used by backend tests. Product slices are created only by
// approving an owner-bound slice request.
export const createFixture = internalMutation({
  args: {
    name: v.string(),
    ttlMs: v.number(),
    apps: v.array(appValidator),
    bindings: v.optional(v.array(bindingValidator)),
    mintPolicy: v.optional(mintPolicyValidator),
  },
  returns: v.object({
    id: v.id("slices"),
    sliceToken: v.string(),
    sliceSecret: v.string(),
    expiresAt: v.number(),
    name: v.string(),
    apps: v.array(appValidator),
    mintPolicy: mintPolicyValidator,
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to continue");
    const name = args.name.trim();
    if (!name || name.length > MAX_SLICE_NAME)
      throw new Error("Name must be 1 to 80 characters");
    if (
      !Number.isFinite(args.ttlMs) ||
      args.ttlMs <= 0 ||
      args.ttlMs > MAX_TTL_MS
    ) {
      throw new Error("ttlMs must be between 1 millisecond and 7 days");
    }
    const bindings = await validatedBindings(
      ctx,
      userId,
      args.bindings,
      args.apps,
    );
    const agentId = `fixture:${userId}`;
    const fixtureAgent = await ctx.db
      .query("agentConnections")
      .withIndex("by_agentId_status", (q) =>
        q.eq("agentId", agentId).eq("status", "active"),
      )
      .unique();
    if (fixtureAgent && fixtureAgent.userId !== userId) {
      throw new Error("Fixture agent belongs to another user");
    }
    if (!fixtureAgent) {
      await ctx.db.insert("agentConnections", {
        userId,
        agentId,
        name,
        secretHash: await sha256Hex(randomSecret("fixture_")),
        status: "active",
      });
    }
    return await createSlice(ctx, {
      userId,
      agentId,
      name,
      ttlMs: args.ttlMs,
      mintPolicy: args.mintPolicy ?? "auto",
      bindings,
    });
  },
});

export const setMintPolicy = authenticatedMutation({
  args: { sliceToken: v.string(), mintPolicy: mintPolicyValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slice = await ctx.db
      .query("slices")
      .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
      .unique();
    if (!slice || slice.userId !== ctx.userId)
      throw new Error("Slice not found");
    if (effectiveStatus(slice) !== "active")
      throw new Error("Slice is not live");
    await ctx.db.patch("slices", slice._id, { mintPolicy: args.mintPolicy });
    return null;
  },
});

export const setBinding = authenticatedMutation({
  args: {
    sliceToken: v.string(),
    app: appValidator,
    enabled: v.boolean(),
    connectionId: v.id("connections"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slice = await ctx.db
      .query("slices")
      .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
      .unique();
    if (!slice || slice.userId !== ctx.userId)
      throw new Error("Slice not found");
    if (effectiveStatus(slice) !== "active")
      throw new Error("Slice is not live");
    const binding = await bindingForConnection(
      ctx,
      slice._id,
      args.app,
      args.connectionId,
    );
    if (!args.enabled) {
      if (binding) await ctx.db.delete("sliceBindings", binding._id);
      return null;
    }
    if (
      !(await selectedConnection(ctx, ctx.userId, args.app, args.connectionId))
    ) {
      throw new Error(`Select a connected account for ${args.app}`);
    }
    if (!binding) {
      await ctx.db.insert("sliceBindings", {
        sliceId: slice._id,
        app: args.app,
        connectionId: args.connectionId,
      });
    }
    return null;
  },
});

export const revoke = authenticatedMutation({
  args: { sliceToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slice = await ctx.db
      .query("slices")
      .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
      .unique();
    if (!slice || slice.userId !== ctx.userId)
      throw new Error("Slice not found");
    if (slice.status !== "revoked") {
      await ctx.db.patch("slices", slice._id, { status: "revoked" });
    }
    return null;
  },
});

export const revokeBySecret = internalMutation({
  args: { sliceToken: v.string(), sliceSecret: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const slice = await sliceBySecret(ctx, args);
    if (!slice) return false;
    if (slice.status !== "revoked") {
      await ctx.db.patch("slices", slice._id, { status: "revoked" });
    }
    return true;
  },
});
