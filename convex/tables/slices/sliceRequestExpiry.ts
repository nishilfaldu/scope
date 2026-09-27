import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import {
  activeConnectionForAgent,
  agentAccessRevokedAt,
} from "../agentConnections";
import { sliceHandoff } from "../../domain/handoff";

export const clearClaimSecret = internalMutation({
  args: { requestId: v.id("sliceRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get("sliceRequests", args.requestId);
    if (
      !request ||
      request.status === "denied" ||
      request.claimAcknowledgedAt !== undefined
    )
      return null;
    const slice = request.createdSliceId
      ? await ctx.db.get("slices", request.createdSliceId)
      : null;
    const parent = await activeConnectionForAgent(ctx, request.agentId);
    const handoff = sliceHandoff(
      request,
      slice,
      !!parent,
      Date.now(),
      parent ? undefined : await agentAccessRevokedAt(ctx, request.agentId),
    );
    if (!handoff.reasonCode) return null;
    if (slice?.status === "staged" && handoff.reasonCode !== "slice_expired") {
      await ctx.db.patch("slices", slice._id, {
        status: "revoked",
        revokedAt: handoff.terminalAt,
        revocationReason: handoff.reasonCode,
      });
    }
    await ctx.db.patch("sliceRequests", request._id, {
      terminalReason: handoff.reasonCode,
      issuedSliceSecretCipher: "",
      claimHandleCipher: "",
    });
    return null;
  },
});
