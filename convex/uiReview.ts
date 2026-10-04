import { v } from "convex/values";
import { env, internalMutation } from "./_generated/server";
import { authorizationKey } from "./scope";
import type { Id } from "./_generated/dataModel";

const prefix = "scope-ui-review-v1";
const demoIssuer = "https://scope-ui-demo.invalid";

// Internal admin tooling: fixtures must never be written to another deployment.
export const prepare = internalMutation({
  args: { ownerId: v.string() },
  returns: v.object({
    accounts: v.record(v.string(), v.id("connectedAccounts")),
    agents: v.record(v.string(), v.id("clientConnections")),
  }),
  handler: async (ctx, { ownerId }) => {
    if (env.CONVEX_CLOUD_URL !== "https://bright-dinosaur-692.convex.cloud")
      throw new Error("UI review fixtures are restricted to personal dev.");
    if (!/^user_[A-Za-z0-9]+$/.test(ownerId)) throw new Error("Invalid owner.");
    const [accountRows, agentRows, requestRows] = await Promise.all([
      ctx.db
        .query("connectedAccounts")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .take(201),
      ctx.db
        .query("clientConnections")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .take(201),
      ctx.db
        .query("approvalRequests")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .take(201),
    ]);
    if (
      [accountRows, agentRows, requestRows].some((rows) => rows.length === 201)
    )
      throw new Error("Too many rows for this bounded review seed.");
    if (
      !accountRows.some((a) => a.connect.issuer !== demoIssuer) &&
      !agentRows.some((a) => a.issuer !== demoIssuer)
    )
      throw new Error("The owner must already have Scope data.");

    // Only these synthetic requests are reset. Existing account and agent IDs
    // stay stable so reviewing names and decisions never affects live records.
    for (const request of requestRows)
      if (request.key.startsWith(`${prefix}:`))
        await ctx.db.delete("approvalRequests", request._id);
    const now = Date.now();
    const accounts: Record<string, Id<"connectedAccounts">> = {};
    for (const spec of [
      { key: "active", label: "Demo · Maya (Design workspace)" },
      {
        key: "long",
        label: "Demo · Jordan (Platform engineering and customer operations)",
      },
      {
        key: "disconnected",
        label: "Demo · Archived workspace",
        outcome: "succeeded",
      },
      {
        key: "failed",
        label: "Demo · Disconnect needs retry",
        outcome: "failed",
      },
      {
        key: "disconnecting",
        label: "Demo · Disconnect in progress",
        outcome: "pending",
      },
    ] as const) {
      const subjectId = `${prefix}:${spec.key}`;
      const outcome = "outcome" in spec ? spec.outcome : undefined;
      const values = {
        ownerId,
        providerId: "slack",
        providerName: "Slack",
        label: spec.label,
        accessDescription: "Read channel names",
        providerUserId: `demo-user-${spec.key}`,
        providerTenantId: `demo-workspace-${spec.key}`,
        providerEmail: `${spec.key}@example.test`,
        connect: {
          connectorId: `${prefix}:${spec.key}`,
          subjectId,
          issuer: demoIssuer,
        },
        grantedScopes: ["channels:read", "identify"],
        authorizationKey: authorizationKey(
          "slack",
          `demo-user-${spec.key}`,
          `demo-workspace-${spec.key}`,
          `${prefix}:${spec.key}`,
        ),
        grantVersion: 1,
        state: outcome ? ("blocked" as const) : ("active" as const),
        blockedAt: outcome ? now - 6 * 60_000 : undefined,
        disconnectOutcome: outcome,
      };
      const previous = accountRows.find(
        (a) =>
          a.connect.issuer === demoIssuer && a.connect.subjectId === subjectId,
      );
      if (previous) {
        await ctx.db.replace("connectedAccounts", previous._id, values);
        accounts[spec.key] = previous._id;
      } else
        accounts[spec.key] = await ctx.db.insert("connectedAccounts", values);
    }
    const agents: Record<string, Id<"clientConnections">> = {};
    for (const spec of [
      { key: "research", name: "Demo · Research assistant" },
      { key: "release", name: "Demo · Release coordinator" },
      {
        key: "long",
        name: "Demo · Weekly digest assistant for engineering and customer success",
      },
      { key: "stopped", name: "Demo · Stopped assistant" },
    ]) {
      const sessionId = `${prefix}:${spec.key}`;
      const values = {
        ownerId,
        subject: ownerId,
        issuer: demoIssuer,
        clientId: prefix,
        sessionId,
        name: spec.name,
        stoppedAt: spec.key === "stopped" ? now - 5 * 60_000 : undefined,
      };
      const previous = agentRows.find(
        (a) => a.issuer === demoIssuer && a.sessionId === sessionId,
      );
      if (previous) {
        await ctx.db.replace("clientConnections", previous._id, values);
        agents[spec.key] = previous._id;
      } else
        agents[spec.key] = await ctx.db.insert("clientConnections", values);
    }
    return { accounts, agents };
  },
});
