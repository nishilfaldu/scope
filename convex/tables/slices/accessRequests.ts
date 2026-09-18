import { v } from "convex/values";
import { authenticatedMutation, authenticatedQuery } from "../../functions";
import { appValidator } from "../../domain/apps";
import {
  requestStatusValidator,
  effectiveRequestStatus,
} from "../../domain/requests";
import { encryptToken } from "../../lib/tokenEncryption";
import { createSlice, validatedBindings } from "./helpers";
import { selectedConnection } from "../connections/helpers";

export const CLAIM_WINDOW_MS = 60 * 1000;

const newSliceRequest = v.object({
  kind: v.literal("onboarding"),
  publicToken: v.string(),
  status: requestStatusValidator,
  agentName: v.string(),
  apps: v.array(appValidator),
  ttlMs: v.number(),
  reason: v.optional(v.string()),
  expiresAt: v.number(),
});
const tokenRequest = v.object({
  kind: v.literal("mint"),
  publicToken: v.string(),
  status: requestStatusValidator,
  sliceName: v.string(),
  app: appValidator,
  accountLogin: v.union(v.string(), v.null()),
  expiresAt: v.number(),
});

export const getNewSlice = authenticatedQuery({
  args: { publicToken: v.string() },
  returns: v.union(newSliceRequest, v.null()),
  handler: async (ctx, { publicToken }) => {
    const request = await ctx.db
      .query("accessRequests")
      .withIndex("by_public_token", (q) => q.eq("publicToken", publicToken))
      .unique();
    if (
      !request ||
      request.kind !== "onboarding" ||
      (request.userId && request.userId !== ctx.userId)
    )
      return null;
    return {
      kind: "onboarding" as const,
      publicToken,
      status: effectiveRequestStatus(request, Date.now()),
      agentName: request.agentName,
      apps: request.apps,
      ttlMs: request.ttlMs,
      reason: request.reason,
      expiresAt: request.expiresAt,
    };
  },
});

export const getToken = authenticatedQuery({
  args: { publicToken: v.string() },
  returns: v.union(tokenRequest, v.null()),
  handler: async (ctx, { publicToken }) => {
    const request = await ctx.db
      .query("accessRequests")
      .withIndex("by_public_token", (q) => q.eq("publicToken", publicToken))
      .unique();
    if (!request || request.kind !== "mint" || request.userId !== ctx.userId)
      return null;
    const slice = await ctx.db.get("slices", request.sliceId);
    if (!slice || slice.userId !== ctx.userId) return null;
    const binding = request.bindingId
      ? await ctx.db.get("sliceBindings", request.bindingId)
      : null;
    const connection =
      binding && binding.sliceId === slice._id && binding.app === request.app
        ? await selectedConnection(
            ctx,
            ctx.userId,
            request.app,
            binding.connectionId,
          )
        : null;
    return {
      kind: "mint" as const,
      publicToken,
      status: effectiveRequestStatus(request, Date.now()),
      sliceName: slice.name,
      app: request.app,
      accountLogin: connection?.login ?? null,
      expiresAt: request.expiresAt,
    };
  },
});

export const decide = authenticatedMutation({
  args: {
    publicToken: v.string(),
    decision: v.union(v.literal("approved"), v.literal("denied")),
    bindings: v.optional(
      v.array(
        v.object({ app: appValidator, connectionId: v.id("connections") }),
      ),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("accessRequests")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", args.publicToken),
      )
      .unique();
    if (!request || (request.userId && request.userId !== ctx.userId))
      throw new Error("Request unavailable");
    if (request.kind === "mint") {
      const slice = await ctx.db.get("slices", request.sliceId);
      if (
        !slice ||
        request.userId !== slice.userId ||
        slice.userId !== ctx.userId
      )
        throw new Error("Request unavailable");
    }
    if (effectiveRequestStatus(request, Date.now()) !== "pending")
      throw new Error("Request is no longer pending");
    const now = Date.now();
    if (args.decision === "denied") {
      await ctx.db.patch("accessRequests", request._id, {
        status: "denied",
        decidedAt: now,
        ...(request.kind === "onboarding" ? { claimHandleCipher: "" } : {}),
      });
      return null;
    }
    if (request.kind === "mint") {
      const binding = request.bindingId
        ? await ctx.db.get("sliceBindings", request.bindingId)
        : null;
      if (
        !binding ||
        binding.sliceId !== request.sliceId ||
        binding.app !== request.app ||
        !(await selectedConnection(
          ctx,
          ctx.userId,
          request.app,
          binding.connectionId,
        ))
      ) {
        throw new Error(
          "The requested account is no longer allowed on this slice",
        );
      }
      await ctx.db.patch("accessRequests", request._id, {
        status: "approved",
        decidedAt: now,
        expiresAt: now + CLAIM_WINDOW_MS,
      });
      return null;
    }
    const bindings = await validatedBindings(
      ctx,
      ctx.userId,
      args.bindings,
      request.apps,
    );
    const created = await createSlice(ctx, {
      userId: ctx.userId,
      name: request.agentName,
      ttlMs: request.ttlMs,
      mintPolicy: "auto",
      bindings,
    });
    await ctx.db.patch("accessRequests", request._id, {
      status: "approved",
      decidedAt: now,
      userId: ctx.userId,
      sliceId: created.id,
      issuedSliceToken: created.sliceToken,
      issuedSliceSecretCipher: await encryptToken(created.sliceSecret),
      expiresAt: now + CLAIM_WINDOW_MS,
    });
    return null;
  },
});
