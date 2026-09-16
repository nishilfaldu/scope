import { v } from "convex/values";
import { authenticatedMutation } from "../../functions";
import {
  isAppId,
  providerForApp,
  type AppId,
} from "../../domain/apps";
import { encryptToken } from "../../lib/tokenEncryption";
import { randomSecret, sha256Hex } from "../../lib/secrets";
import { ensurePassport } from "../passports";
import { CLAIM_WINDOW_MS } from "./accessRequestsBoard";

export const decide = authenticatedMutation({
  args: {
    requestId: v.id("accessRequests"),
    decision: v.union(v.literal("approved"), v.literal("denied")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx;
    const request = await ctx.db.get("accessRequests", args.requestId);
    if (!request) {
      throw new Error("Request not found");
    }
    if (request.userId && request.userId !== userId) {
      throw new Error("Request not found");
    }
    const now = Date.now();
    if (request.status === "pending" && request.expiresAt <= now) {
      await ctx.db.patch("accessRequests", request._id, { status: "expired" });
      throw new Error("Request expired");
    }
    if (request.status !== "pending") {
      throw new Error("Request is no longer pending");
    }

    // Bind unbound onboarding requests to the deciding user.
    if (!request.userId) {
      await ctx.db.patch("accessRequests", request._id, { userId });
    }

    if (args.decision === "denied") {
      await ctx.db.patch("accessRequests", request._id, {
        status: "denied",
        decidedAt: now,
        userId,
      });
      return null;
    }

    if (request.kind === "mint") {
      await ctx.db.patch("accessRequests", request._id, {
        status: "approved",
        decidedAt: now,
        userId,
        expiresAt: now + CLAIM_WINDOW_MS,
      });
      return null;
    }

    // Onboarding approve → create live slice; agent claims secrets over HTTPS.
    const agentName = (request.agentName ?? "agent").trim();
    const apps = (request.apps ?? []).filter((app): app is AppId => isAppId(app));
    const ttlMs = request.ttlMs ?? 0;
    if (apps.length === 0 || ttlMs <= 0) {
      throw new Error("Onboarding request is incomplete");
    }
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_user_and_provider", (q) => q.eq("userId", userId))
      .collect();
    if (connections.length === 0) {
      throw new Error(
        "Connect an account at /connections before approving this request",
      );
    }
    const connectedProviders = new Set(
      connections.map((connection) => connection.provider),
    );
    const unavailable = apps.find(
      (app) => !connectedProviders.has(providerForApp(app)),
    );
    if (unavailable) {
      throw new Error(
        `Connect ${providerForApp(unavailable)} before allowing ${unavailable}`,
      );
    }

    const passportId = await ensurePassport(ctx, userId);
    const expiresAt = now + ttlMs;
    const grantId = await ctx.db.insert("grants", {
      passportId,
      userId,
      agent: agentName,
      apps,
      expiresAt,
    });
    const token = randomSecret("st_");
    const sliceSecret = randomSecret("ss_");
    const secretHash = await sha256Hex(sliceSecret);
    const sliceId = await ctx.db.insert("slices", {
      passportId,
      grantId,
      userId,
      name: agentName,
      token,
      secretHash,
      status: "active",
      expiresAt,
      // Onboarding already required Approve; subsequent mints use auto.
      mintPolicy: "auto",
    });
    const issuedSliceSecretCipher = await encryptToken(sliceSecret);
    await ctx.db.patch("accessRequests", request._id, {
      status: "approved",
      decidedAt: now,
      userId,
      sliceId,
      issuedSliceToken: token,
      issuedSliceSecretCipher,
      expiresAt: now + CLAIM_WINDOW_MS,
    });
    return null;
  },
});
