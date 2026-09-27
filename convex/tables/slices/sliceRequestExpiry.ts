import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

export const clearClaimSecret = internalMutation({
  args: { requestId: v.id("sliceRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get("sliceRequests", args.requestId);
    if (request && request.expiresAt <= Date.now()) {
      if (
        (request.status === "approved" || request.status === "claimed") &&
        !request.claimAcknowledgedAt &&
        request.createdSliceId
      ) {
        await ctx.db.patch("slices", request.createdSliceId, {
          status: "revoked",
        });
      }
      await ctx.db.patch("sliceRequests", request._id, {
        issuedSliceSecretCipher: "",
        claimHandleCipher: "",
      });
    }
    return null;
  },
});
