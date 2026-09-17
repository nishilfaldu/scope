import { httpAction, env } from "../_generated/server";
import { internal } from "../_generated/api";
import { readObjectBody, requiredString } from "../lib/requests";
import { errorResponse, jsonResponse } from "../lib/responses";
import { parseBoardOrigin } from "./helpers";
import { mintCredential } from "./mint";

export const httpCredentialsHandler = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) return body;
  const sliceToken = requiredString(body, "sliceToken");
  if (sliceToken instanceof Response) return sliceToken;
  const sliceSecret = requiredString(body, "sliceSecret");
  if (sliceSecret instanceof Response) return sliceSecret;
  const app = requiredString(body, "app");
  if (app instanceof Response) return app;

  const decision = await ctx.runMutation(
    internal.tables.slices.credentials.authorizeCreate,
    { sliceToken, sliceSecret, app },
  );
  if (!decision.ok) return errorResponse(decision.status, decision.reason, decision.code);

  if (decision.mintPolicy === "approve") {
    const pending = await ctx.runMutation(
      internal.tables.slices.accessRequestsMint.createPending,
      { sliceId: decision.sliceId, userId: decision.userId, app: decision.app },
    );
    if (!pending.ok) return errorResponse(pending.status, pending.reason, pending.code);
    const boardOrigin = parseBoardOrigin(env.BOARD_ORIGIN);
    return jsonResponse(202, {
      error: pending.reason, code: pending.code, requestId: pending.requestId,
      status: pending.status, expiresAt: pending.expiresAt, app: decision.app,
      approvalUrl: `${boardOrigin}/approvals/${pending.publicToken}`,
    });
  }
  return await mintCredential(ctx, decision);
});
