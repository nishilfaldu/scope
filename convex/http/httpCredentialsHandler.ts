import { httpAction } from "../_generated/server";
import { env } from "../_generated/server";
import { internal } from "../_generated/api";
import { APP_UNAVAILABLE_ERROR, type AgentErrorCode } from "../lib/errors";
import { issueShortLivedAccess } from "../oauth/access";
import { readObjectBody, requiredString } from "../lib/requests";
import { errorResponse, jsonResponse } from "../lib/responses";
import { parseBoardOrigin } from "./helpers";

export const httpCredentialsHandler = httpAction(async (ctx, request) => {
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
  const app = requiredString(body, "app");
  if (app instanceof Response) {
    return app;
  }
  if (body.refresh !== undefined && typeof body.refresh !== "boolean") {
    return errorResponse(400, "refresh must be a boolean", "INVALID_REQUEST");
  }
  const refresh = body.refresh === true;

  const decision = await ctx.runMutation(
    internal.tables.slices.credentials.authorizeCreate,
    { sliceToken, sliceSecret, app, refresh },
  );
  if (!decision.ok) {
    return errorResponse(decision.status, decision.reason, decision.code);
  }

  if (decision.mintPolicy === "approve") {
    const pending = await ctx.runMutation(
      internal.tables.slices.accessRequestsMint.createPending,
      {
        sliceId: decision.sliceId,
        userId: decision.userId,
        app: decision.app,
        refresh: decision.refresh,
      },
    );
    if (!pending.ok) {
      return errorResponse(pending.status, pending.reason, pending.code);
    }
    const boardOrigin = parseBoardOrigin(env.BOARD_ORIGIN);
    return jsonResponse(202, {
      error: pending.reason,
      code: pending.code,
      requestId: pending.requestId,
      status: pending.status,
      expiresAt: pending.expiresAt,
      app: decision.app,
      approvalUrl: `${boardOrigin}/approvals/${pending.publicToken}`,
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
      refresh,
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
  });
});
