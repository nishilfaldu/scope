import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { errorResponse, jsonResponse } from "../lib/responses";
import { requiredHeader } from "../lib/requests";

export const httpAppsHandler = httpAction(async (ctx, request) => {
  const passportToken = requiredHeader(request, "passportToken");
  if (passportToken instanceof Response) {
    return passportToken;
  }
  const passportSecret = requiredHeader(request, "passportSecret");
  if (passportSecret instanceof Response) {
    return passportSecret;
  }

  const decision = await ctx.runQuery(
    internal.tables.passports.queries.discoverApps,
    { passportToken, passportSecret, now: Date.now() },
  );
  if (!decision.ok) {
    return errorResponse(decision.status, decision.reason, decision.code);
  }
  return jsonResponse(200, {
    expiresAt: decision.expiresAt,
    apps: decision.apps,
  });
});
