import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

export const clearClaimSecret = internalMutation({
  args: { requestId: v.id("sliceRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get("sliceRequests", args.requestId);
    if (request && request.expiresAt <= Date.now()) {
      await ctx.db.patch("sliceRequests", request._id, {
        issuedSliceSecretCipher: "",
        claimHandleCipher: "",
      });
    }
    return null;
  },
});
