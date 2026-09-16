import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { APP_UNAVAILABLE_ERROR, type AgentErrorCode } from "../lib/errors";
import { issueShortLivedAccess } from "../oauth/access";
import { readObjectBody, requiredString } from "../lib/requests";
import { errorResponse, jsonResponse } from "../lib/responses";

export const httpClaimHandler = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) {
    return body;
  }

  const sliceToken = requiredString(body, "sliceToken");
  if (sliceToken instanceof Response) {
    return sliceToken;
  }
  const sliceSecret = requiredString(body, "sliceSecret");
  if (sliceSecret instanceof Response) {
    return sliceSecret;
  }
  const requestIdRaw = requiredString(body, "requestId");
  if (requestIdRaw instanceof Response) {
    return requestIdRaw;
  }

  // Convex Ids are opaque strings; normalize via resolveClaim ownership checks.
  const requestId = requestIdRaw as Id<"accessRequests">;

  const decision = await ctx.runMutation(
    internal.tables.slices.accessRequests.resolveClaim,
    { sliceToken, sliceSecret, requestId },
  );
  if (!decision.ok) {
    return errorResponse(decision.status, decision.reason, decision.code);
  }

  if (decision.kind === "pending") {
    return jsonResponse(202, {
      error: "Operator approval required before this credential can be minted",
      code: "APPROVAL_REQUIRED",
      requestId: decision.requestId,
      status: decision.status,
      expiresAt: decision.expiresAt,
      app: decision.app,
    });
  }

  const issued = await issueShortLivedAccess(
    ctx,
    decision.userId,
    decision.provider,
  );
  if ("error" in issued) {
    const status = issued.code === "APP_UNAVAILABLE" ? 403 : 503;
    const code: AgentErrorCode = issued.code;
    const error =
      issued.code === "APP_UNAVAILABLE" ? APP_UNAVAILABLE_ERROR : issued.error;
    return errorResponse(status, error, code);
  }

  const committed = await ctx.runMutation(
    internal.tables.slices.credentials.commitCreate,
    {
      sliceId: decision.sliceId,
      app: decision.app,
      expiresAt: issued.expiresAt,
      refresh: decision.refresh,
    },
  );
  return jsonResponse(200, {
    accessToken: issued.accessToken,
    tokenType: "Bearer",
    app: decision.app,
    expiresAt: committed.expiresAt,
    expiresIn: Math.max(
      0,
      Math.floor((committed.expiresAt - Date.now()) / 1000),
    ),
    requestId: decision.requestId,
  });
});
