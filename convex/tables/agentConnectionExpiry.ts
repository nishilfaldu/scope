import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

export const expireInvite = internalMutation({
  args: { publicToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("agentConnectionInvites")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", args.publicToken),
      )
      .unique();
    if (
      !invite ||
      invite.expiresAt > Date.now() ||
      (invite.status !== "pending" &&
        invite.status !== "approved" &&
        invite.status !== "claimed")
    ) {
      return null;
    }
    if (invite.status === "claimed") {
      if (
        !invite.replacesAgentConnectionId &&
        !invite.claimAcknowledgedAt &&
        invite.agentConnectionId
      ) {
        await ctx.db.patch("agentConnections", invite.agentConnectionId, {
          status: "revoked",
          revokedAt: Date.now(),
        });
      }
      await ctx.db.patch("agentConnectionInvites", invite._id, {
        issuedSecretCipher: "",
      });
      return null;
    }
    if (invite.agentConnectionId) {
      await ctx.db.patch("agentConnections", invite.agentConnectionId, {
        status: "revoked",
        revokedAt: Date.now(),
      });
    }
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      status: "expired",
      issuedSecretCipher: "",
    });
    return null;
  },
});
