import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { readObjectBody, requiredString } from "../lib/requests";
import { errorResponse, jsonResponse } from "../lib/responses";
import { AGENT_ERROR_GUIDANCE } from "../lib/errors";
import { mintCredential } from "./mint";

export const httpClaimHandler = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) return body;
  const sliceToken = requiredString(body, "sliceToken");
  if (sliceToken instanceof Response) return sliceToken;
  const sliceSecret = requiredString(body, "sliceSecret");
  if (sliceSecret instanceof Response) return sliceSecret;
  const requestIdRaw = requiredString(body, "requestId");
  if (requestIdRaw instanceof Response) return requestIdRaw;

  const decision = await ctx.runMutation(
    internal.tables.slices.tokenRequestClaims.resolveClaim,
    {
      sliceToken,
      sliceSecret,
      requestId: requestIdRaw as Id<"tokenRequests">,
    },
  );
  if (!decision.ok)
    return errorResponse(
      decision.status,
      decision.reason,
      decision.code,
      decision,
    );
  if (decision.kind === "pending") {
    return jsonResponse(202, {
      error: "Operator approval required before this credential can be minted",
      code: "APPROVAL_REQUIRED",
      ...AGENT_ERROR_GUIDANCE.APPROVAL_REQUIRED,
      requestId: decision.requestId,
      status: decision.status,
      expiresAt: decision.expiresAt,
      app: decision.app,
    });
  }
  return await mintCredential(ctx, decision);
});
