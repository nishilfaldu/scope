import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/secrets";

const inviteTokens = [
  "ac_demo_new_pending",
  "ac_demo_reconnect_pending",
  "ac_demo_denied",
  "ac_demo_expired",
] as const;
const sliceRequestTokens = [
  "ar_demo_slice_pending",
  "ar_demo_slice_approved",
  "ar_demo_slice_denied",
  "ar_demo_slice_expired",
] as const;
const tokenRequestTokens = [
  "ar_demo_token_pending",
  "ar_demo_token_approved",
  "ar_demo_token_denied",
  "ar_demo_token_expired",
] as const;
const sliceTokens = [
  "st_demo_active_auto",
  "st_demo_active_approve",
  "st_demo_revoked",
  "st_demo_expired",
  "st_demo_research",
] as const;
const agentIds = ["ag_demo_codex", "ag_demo_research"] as const;

export const seedUiDemo = internalMutation({
  args: { userId: v.id("users") },
  returns: v.object({
    agentsPath: v.string(),
    connectionsPath: v.string(),
    connectionLinks: v.array(v.object({ label: v.string(), path: v.string() })),
    sliceRequestLinks: v.array(
      v.object({ label: v.string(), path: v.string() }),
    ),
    tokenRequestLinks: v.array(
      v.object({ label: v.string(), path: v.string() }),
    ),
    sliceLinks: v.array(v.object({ label: v.string(), path: v.string() })),
  }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("users", userId);
    if (!user) throw new Error("Demo user not found");

    for (const token of inviteTokens) {
      const row = await ctx.db
        .query("agentConnectionInvites")
        .withIndex("by_public_token", (q) => q.eq("publicToken", token))
        .unique();
      if (row) await ctx.db.delete("agentConnectionInvites", row._id);
    }
    for (const token of sliceRequestTokens) {
      const row = await ctx.db
        .query("sliceRequests")
        .withIndex("by_public_token", (q) => q.eq("publicToken", token))
        .unique();
      if (row) await ctx.db.delete("sliceRequests", row._id);
    }
    for (const token of tokenRequestTokens) {
      const row = await ctx.db
        .query("tokenRequests")
        .withIndex("by_public_token", (q) => q.eq("publicToken", token))
        .unique();
      if (row) await ctx.db.delete("tokenRequests", row._id);
    }

    for (const token of sliceTokens) {
      const slice = await ctx.db
        .query("slices")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      if (!slice) continue;
      const bindings = await ctx.db
        .query("sliceBindings")
        .withIndex("by_slice_app_connectionId", (q) =>
          q.eq("sliceId", slice._id),
        )
        .take(50);
      for (const binding of bindings) {
        await ctx.db.delete("sliceBindings", binding._id);
      }
      await ctx.db.delete("slices", slice._id);
    }

    for (const agentId of agentIds) {
      const rows = await ctx.db
        .query("agentConnections")
        .withIndex("by_user_agent", (q) =>
          q.eq("userId", userId).eq("agentId", agentId),
        )
        .take(20);
      for (const row of rows) {
        await ctx.db.delete("agentConnections", row._id);
      }
    }

    const demoAccounts = [
      {
        app: "github" as const,
        providerUserId: "demo-github",
        login: "demo-octocat",
      },
      {
        app: "gmail" as const,
        providerUserId: "demo-gmail",
        login: "demo.inbox@example.test",
      },
      {
        app: "slack" as const,
        providerUserId: "demo-slack",
        login: "Demo Workspace",
      },
    ];
    const accounts = new Map<string, Id<"connections">>();
    for (const account of demoAccounts) {
      const existing = await ctx.db
        .query("connections")
        .withIndex("by_user_app_providerUserId", (q) =>
          q
            .eq("userId", userId)
            .eq("app", account.app)
            .eq("providerUserId", account.providerUserId),
        )
        .unique();
      if (existing) await ctx.db.delete("connections", existing._id);
      const id = await ctx.db.insert("connections", {
        userId,
        app: account.app,
        providerUserId: account.providerUserId,
        login: account.login,
        accessToken: "demo-token-not-valid",
        refreshToken: "demo-refresh-not-valid",
        tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      });
      accounts.set(account.app, id);
    }

    const now = Date.now();
    const oldCodexId = await ctx.db.insert("agentConnections", {
      userId,
      agentId: "ag_demo_codex",
      name: "Codex Desktop Demo",
      secretHash: await sha256Hex("acs_demo_codex_old"),
      status: "revoked",
      lastUsedAt: now - 3 * 24 * 60 * 60 * 1000,
      revokedAt: now - 2 * 24 * 60 * 60 * 1000,
    });
    const codexId = await ctx.db.insert("agentConnections", {
      userId,
      agentId: "ag_demo_codex",
      name: "Codex Desktop Demo",
      secretHash: await sha256Hex("acs_demo_codex_current"),
      status: "active",
      lastUsedAt: now - 12 * 60 * 1000,
    });
    await ctx.db.insert("agentConnections", {
      userId,
      agentId: "ag_demo_research",
      name: "Research Agent Demo",
      secretHash: await sha256Hex("acs_demo_research"),
      status: "active",
      lastUsedAt: now - 2 * 60 * 60 * 1000,
    });

    async function insertSlice(args: {
      token: (typeof sliceTokens)[number];
      name: string;
      agentId: string;
      status: "active" | "revoked";
      expiresAt: number;
      mintPolicy: "auto" | "approve";
      apps: ("github" | "gmail" | "slack")[];
    }) {
      const id = await ctx.db.insert("slices", {
        userId,
        agentId: args.agentId,
        name: args.name,
        token: args.token,
        secretHash: await sha256Hex(`ss_${args.token}`),
        status: args.status,
        expiresAt: args.expiresAt,
        mintPolicy: args.mintPolicy,
      });
      const bindingIds = new Map<string, Id<"sliceBindings">>();
      for (const app of args.apps) {
        const connectionId = accounts.get(app);
        if (!connectionId) throw new Error(`Missing demo account for ${app}`);
        const bindingId = await ctx.db.insert("sliceBindings", {
          sliceId: id,
          app,
          connectionId,
        });
        bindingIds.set(app, bindingId);
      }
      return { id, bindingIds };
    }

    const activeAuto = await insertSlice({
      token: "st_demo_active_auto",
      name: "Inbox triage · auto",
      agentId: "ag_demo_codex",
      status: "active",
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      mintPolicy: "auto",
      apps: ["github", "gmail"],
    });
    const activeApprove = await insertSlice({
      token: "st_demo_active_approve",
      name: "Slack release helper · approval",
      agentId: "ag_demo_codex",
      status: "active",
      expiresAt: now + 2 * 24 * 60 * 60 * 1000,
      mintPolicy: "approve",
      apps: ["slack"],
    });
    const revoked = await insertSlice({
      token: "st_demo_revoked",
      name: "Revoked production helper",
      agentId: "ag_demo_codex",
      status: "revoked",
      expiresAt: now + 24 * 60 * 60 * 1000,
      mintPolicy: "auto",
      apps: ["github"],
    });
    const expired = await insertSlice({
      token: "st_demo_expired",
      name: "Expired weekly report",
      agentId: "ag_demo_codex",
      status: "active",
      expiresAt: now - 60 * 60 * 1000,
      mintPolicy: "approve",
      apps: ["gmail"],
    });
    const research = await insertSlice({
      token: "st_demo_research",
      name: "Research sources",
      agentId: "ag_demo_research",
      status: "active",
      expiresAt: now + 5 * 24 * 60 * 60 * 1000,
      mintPolicy: "auto",
      apps: ["github"],
    });

    const invites = [
      {
        publicToken: "ac_demo_new_pending",
        claimHandle: "ach_demo_new_pending",
        agentId: "ag_demo_new_agent",
        agentName: "Calendar Planning Agent",
        status: "pending" as const,
        expiresAt: now + 24 * 60 * 60 * 1000,
      },
      {
        publicToken: "ac_demo_reconnect_pending",
        claimHandle: "ach_demo_reconnect_pending",
        agentId: "ag_demo_codex",
        agentName: "Codex Desktop Demo",
        status: "pending" as const,
        expiresAt: now + 24 * 60 * 60 * 1000,
        userId,
        replacesAgentConnectionId: codexId,
      },
      {
        publicToken: "ac_demo_denied",
        claimHandle: "ach_demo_denied",
        agentId: "ag_demo_denied",
        agentName: "Denied Agent",
        status: "denied" as const,
        expiresAt: now + 24 * 60 * 60 * 1000,
        userId,
      },
      {
        publicToken: "ac_demo_expired",
        claimHandle: "ach_demo_expired",
        agentId: "ag_demo_expired",
        agentName: "Expired Agent",
        status: "expired" as const,
        expiresAt: now - 60 * 60 * 1000,
        userId,
      },
    ];
    for (const invite of invites) {
      const { claimHandle, ...storedInvite } = invite;
      await ctx.db.insert("agentConnectionInvites", {
        ...storedInvite,
        claimSecretHash: await sha256Hex(claimHandle),
      });
    }

    const sliceRequests = [
      {
        token: "ar_demo_slice_pending",
        status: "pending" as const,
        expiresAt: now + 24 * 60 * 60 * 1000,
        reason: "Summarize new issues and important email before standup.",
      },
      {
        token: "ar_demo_slice_approved",
        status: "approved" as const,
        expiresAt: now + 24 * 60 * 60 * 1000,
        reason: "Prepare an approved release summary.",
      },
      {
        token: "ar_demo_slice_denied",
        status: "denied" as const,
        expiresAt: now + 24 * 60 * 60 * 1000,
        reason: "Access was declined by the operator.",
      },
      {
        token: "ar_demo_slice_expired",
        status: "pending" as const,
        expiresAt: now - 60 * 60 * 1000,
        reason: "This request was not reviewed in time.",
      },
    ];
    for (const request of sliceRequests) {
      await ctx.db.insert("sliceRequests", {
        publicToken: request.token,
        claimSecretHash: await sha256Hex(`ch_${request.token}`),
        agentId: "ag_demo_codex",
        apps: ["github", "gmail"],
        ttlMs: 3 * 24 * 60 * 60 * 1000,
        reason: request.reason,
        status: request.status,
        expiresAt: request.expiresAt,
        createdSliceId:
          request.status === "approved" ? activeAuto.id : undefined,
      });
    }

    const slackBinding = activeApprove.bindingIds.get("slack");
    if (!slackBinding) throw new Error("Missing Slack demo binding");
    const tokenRequests = [
      {
        token: "ar_demo_token_pending",
        status: "pending" as const,
        expiresAt: now + 24 * 60 * 60 * 1000,
      },
      {
        token: "ar_demo_token_approved",
        status: "approved" as const,
        expiresAt: now + 24 * 60 * 60 * 1000,
      },
      {
        token: "ar_demo_token_denied",
        status: "denied" as const,
        expiresAt: now + 24 * 60 * 60 * 1000,
      },
      {
        token: "ar_demo_token_expired",
        status: "pending" as const,
        expiresAt: now - 60 * 60 * 1000,
      },
    ];
    for (const request of tokenRequests) {
      await ctx.db.insert("tokenRequests", {
        publicToken: request.token,
        sliceId: activeApprove.id,
        app: "slack",
        bindingId: slackBinding,
        status: request.status,
        expiresAt: request.expiresAt,
      });
    }

    void oldCodexId;
    return {
      agentsPath: "/agents",
      connectionsPath: "/connections",
      connectionLinks: invites.map((invite) => ({
        label: `${invite.agentName} · ${invite.status}${invite.replacesAgentConnectionId ? " reconnect" : ""}`,
        path: `/connect/${invite.publicToken}`,
      })),
      sliceRequestLinks: sliceRequests.map((request) => ({
        label: `New slice · ${request.status}${request.expiresAt <= now ? " (expired)" : ""}`,
        path: `/requests/new/${request.token}`,
      })),
      tokenRequestLinks: tokenRequests.map((request) => ({
        label: `Token · ${request.status}${request.expiresAt <= now ? " (expired)" : ""}`,
        path: `/requests/token/${request.token}`,
      })),
      sliceLinks: [
        { label: "Active auto slice", path: `/slices/${activeAuto.id}` },
        { label: "Active approval slice", path: `/slices/${activeApprove.id}` },
        { label: "Revoked slice", path: `/slices/${revoked.id}` },
        { label: "Expired slice", path: `/slices/${expired.id}` },
        { label: "Second agent slice", path: `/slices/${research.id}` },
      ],
    };
  },
});
