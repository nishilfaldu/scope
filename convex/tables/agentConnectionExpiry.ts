import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { projectConnectionHandoff } from "./agentConnections";

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
      invite.status === "denied" ||
      invite.status === "expired" ||
      invite.claimAcknowledgedAt !== undefined ||
      invite.activatedAt !== undefined
    )
      return null;
    const connection = invite.agentConnectionId
      ? await ctx.db.get("agentConnections", invite.agentConnectionId)
      : null;
    const handoff = await projectConnectionHandoff(
      ctx,
      invite,
      connection,
      Date.now(),
    );
    if (!handoff.reason) return null;
    if (connection?.status === "staged")
      await ctx.db.patch("agentConnections", connection._id, {
        status: "revoked",
        revokedAt: handoff.terminalAt,
        revocationReason: handoff.reason,
      });
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      status: "expired",
      terminalReason: handoff.reason,
      issuedSecretCipher: "",
    });
    return null;
  },
});
