import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { readObjectBody, requiredString } from "../lib/requests";
import { errorResponse, jsonResponse } from "../lib/responses";

export const httpRevokeSliceHandler = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) return body;
  const sliceToken = requiredString(body, "sliceToken");
  if (sliceToken instanceof Response) return sliceToken;
  const sliceSecret = requiredString(body, "sliceSecret");
  if (sliceSecret instanceof Response) return sliceSecret;
  const revoked = await ctx.runMutation(
    internal.tables.slices.mutations.revokeBySecret,
    { sliceToken, sliceSecret },
  );
  if (!revoked) {
    return errorResponse(
      401,
      "Unknown slice token or slice secret",
      "UNAUTHORIZED",
    );
  }
  return jsonResponse(200, { status: "revoked" });
});

export const httpCancelTokenRequestHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const sliceToken = requiredString(body, "sliceToken");
    if (sliceToken instanceof Response) return sliceToken;
    const sliceSecret = requiredString(body, "sliceSecret");
    if (sliceSecret instanceof Response) return sliceSecret;
    const requestId = requiredString(body, "requestId");
    if (requestId instanceof Response) return requestId;
    const cancelled = await ctx.runMutation(
      internal.tables.slices.tokenRequestClaims.cancelTokenRequest,
      {
        sliceToken,
        sliceSecret,
        requestId: requestId as Id<"tokenRequests">,
      },
    );
    if (!cancelled) {
      return errorResponse(
        409,
        "Token request cannot be cancelled",
        "INVALID_REQUEST",
      );
    }
    return jsonResponse(200, { status: "cancelled" });
  },
);
