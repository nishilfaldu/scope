import type { GenericActionCtx } from "convex/server";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import type { AppId } from "../domain/apps";
import { APP_UNAVAILABLE_ERROR } from "../lib/errors";
import { errorResponse, jsonResponse } from "../lib/responses";
import { issueShortLivedAccess } from "../oauth/access";
import { googleScopesAreBounded } from "../domain/apps";
import { randomSecret, sha256Hex } from "../lib/secrets";

export async function mintCredential(
  ctx: GenericActionCtx<DataModel>,
  args: {
    sliceId: Id<"slices">;
    userId: Id<"users">;
    app: AppId;
    bindingId: Id<"sliceBindings">;
    connectionId: Id<"connections">;
    requestId?: Id<"tokenRequests">;
  },
): Promise<Response> {
  if (args.app === "drive" || args.app === "docs" || args.app === "sheets") {
    const verified = await issueShortLivedAccess(
      ctx,
      args.userId,
      args.app,
      args.connectionId,
      "server",
    );
    if ("error" in verified) {
      return errorResponse(
        verified.code === "APP_UNAVAILABLE" ? 403 : 503,
        verified.error,
        verified.code,
      );
    }
    if (!googleScopesAreBounded(args.app, verified.grantedScopes)) {
      return errorResponse(
        503,
        "Google connection cannot mint a bounded token",
        "SHORT_LIVED_UNAVAILABLE",
      );
    }
    const brokerToken = randomSecret("gc_", 32);
    const finalized = await ctx.runMutation(
      internal.tables.slices.credentials.finalize,
      {
        sliceId: args.sliceId,
        app: args.app,
        bindingId: args.bindingId,
        connectionId: args.connectionId,
        requestId: args.requestId,
        brokerSecretHash: await sha256Hex(brokerToken),
      },
    );
    if (!finalized.ok) {
      return errorResponse(
        finalized.status,
        finalized.reason,
        finalized.code,
        finalized,
      );
    }
    return jsonResponse(200, {
      brokerToken,
      tokenType: "ScopeBroker",
      endpoint: "/api/google/operations",
      app: args.app,
      bindingId: args.bindingId,
      credentialExpiresAt: finalized.expiresAt,
      ackRequired: false,
      expiresIn: Math.max(
        0,
        Math.floor((finalized.expiresAt - Date.now()) / 1000),
      ),
      ...(args.requestId ? { requestId: args.requestId } : {}),
    });
  }
  const issued = await issueShortLivedAccess(
    ctx,
    args.userId,
    args.app,
    args.connectionId,
  );
  if ("error" in issued) {
    return errorResponse(
      issued.code === "APP_UNAVAILABLE" ? 403 : 503,
      issued.code === "APP_UNAVAILABLE" ? APP_UNAVAILABLE_ERROR : issued.error,
      issued.code,
    );
  }
  const finalized = await ctx.runMutation(
    internal.tables.slices.credentials.finalize,
    {
      sliceId: args.sliceId,
      app: args.app,
      bindingId: args.bindingId,
      connectionId: args.connectionId,
      requestId: args.requestId,
    },
  );
  if (!finalized.ok) {
    return errorResponse(
      finalized.status,
      finalized.reason,
      finalized.code,
      finalized,
    );
  }
  return jsonResponse(200, {
    accessToken: issued.accessToken,
    tokenType: "Bearer",
    app: args.app,
    bindingId: args.bindingId,
    credentialExpiresAt: issued.expiresAt,
    ackRequired: false,
    expiresIn:
      issued.expiresAt === null
        ? null
        : Math.max(0, Math.floor((issued.expiresAt - Date.now()) / 1000)),
    ...(args.requestId ? { requestId: args.requestId } : {}),
  });
}
