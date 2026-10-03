import type { GenericActionCtx } from "convex/server";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import type { AppId } from "../domain/apps";
import { APP_UNAVAILABLE_ERROR } from "../lib/errors";
import { errorResponse, jsonResponse } from "../lib/responses";
import { issueConnectAccess } from "../connect/access";

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
  const issued = await issueConnectAccess(ctx, args.userId, args.connectionId);
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
      connectionGrantVersion: issued.connectionGrantVersion,
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
    expiresIn: Math.max(0, Math.floor((issued.expiresAt - Date.now()) / 1000)),
    ...(args.requestId ? { requestId: args.requestId } : {}),
  });
}
