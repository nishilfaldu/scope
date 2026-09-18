import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { errorResponse, jsonResponse } from "../lib/responses";
import { requiredHeader } from "../lib/requests";

export const httpAccountsHandler = httpAction(async (ctx, request) => {
  const sliceToken = requiredHeader(request, "x-slice-token");
  if (sliceToken instanceof Response) return sliceToken;
  const sliceSecret = requiredHeader(request, "x-slice-secret");
  if (sliceSecret instanceof Response) return sliceSecret;
  const app = new URL(request.url).searchParams.get("app");
  if (!app) return errorResponse(400, "app query parameter is required", "INVALID_REQUEST");

  const result = await ctx.runQuery(internal.tables.slices.queries.discoverAccounts, {
    sliceToken, sliceSecret, app, now: Date.now(),
  });
  if (!result.ok) return errorResponse(result.status, result.reason, result.code);
  return jsonResponse(200, { app: result.app, accounts: result.accounts });
});
