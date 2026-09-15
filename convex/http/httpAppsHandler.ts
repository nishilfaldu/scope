import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { errorResponse, jsonResponse } from "../lib/responses";
import { requiredHeader } from "../lib/requests";

export const httpAppsHandler = httpAction(async (ctx, request) => {
  const sliceToken = requiredHeader(request, "passportToken");
  if (sliceToken instanceof Response) {
    return sliceToken;
  }
  const sliceSecret = requiredHeader(request, "passportSecret");
  if (sliceSecret instanceof Response) {
    return sliceSecret;
  }

  const decision = await ctx.runQuery(
    internal.tables.slices.queries.discoverApps,
    { passportToken: sliceToken, passportSecret: sliceSecret, now: Date.now() },
  );
  if (!decision.ok) {
    return errorResponse(decision.status, decision.reason, decision.code);
  }
  return jsonResponse(200, {
    expiresAt: decision.expiresAt,
    apps: decision.apps,
  });
});
