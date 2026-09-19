/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

describe("agent connections", () => {
  test("reconnect preserves the agent lineage and replaces the only live connection", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "owner@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const other = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "other@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const ownerSession = t.withIdentity({ subject: `${owner}|session` });
    const otherSession = t.withIdentity({ subject: `${other}|session` });

    const firstInviteResponse = await t.fetch("/api/agent-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "Codex" }),
    });
    const firstInvite = await firstInviteResponse.json();
    const firstPublicToken = firstInvite.connectUrl.split("/connect/")[1];
    await ownerSession.mutation(api.tables.agentConnections.decideInvite, {
      publicToken: firstPublicToken,
      decision: "approved",
    });
    const firstClaimResponse = await t.fetch("/api/agent-connections/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: firstInvite.claimHandle }),
    });
    const first = await firstClaimResponse.json();

    const reconnectResponse = await t.fetch("/api/agent-connections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-connection-id": first.agentConnectionId,
        "x-agent-connection-secret": first.agentConnectionSecret,
      },
      body: "{}",
    });
    expect(reconnectResponse.status).toBe(201);
    const reconnect = await reconnectResponse.json();
    expect(reconnect).toMatchObject({
      agentId: first.agentId,
      agentName: "Codex",
      reconnecting: true,
    });
    const reconnectPublicToken = reconnect.connectUrl.split("/connect/")[1];
    expect(
      await otherSession.query(api.tables.agentConnections.getInvite, {
        publicToken: reconnectPublicToken,
      }),
    ).toBeNull();
    await expect(
      otherSession.mutation(api.tables.agentConnections.decideInvite, {
        publicToken: reconnectPublicToken,
        decision: "approved",
      }),
    ).rejects.toThrow("another Scope account");

    await ownerSession.mutation(api.tables.agentConnections.decideInvite, {
      publicToken: reconnectPublicToken,
      decision: "approved",
    });
    const reconnectClaimResponse = await t.fetch(
      "/api/agent-connections/claim",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimHandle: reconnect.claimHandle }),
      },
    );
    const replacement = await reconnectClaimResponse.json();
    expect(replacement.agentId).toBe(first.agentId);
    expect(replacement.agentConnectionId).not.toBe(first.agentConnectionId);

    const connections = await t.run((ctx) =>
      ctx.db
        .query("agentConnections")
        .withIndex("by_user_agent", (q) =>
          q.eq("userId", owner).eq("agentId", first.agentId),
        )
        .collect(),
    );
    expect(
      connections.filter((connection) => connection.status === "active"),
    ).toHaveLength(1);
    expect(
      connections.find(
        (connection) => connection._id === first.agentConnectionId,
      )?.status,
    ).toBe("revoked");

    const staleReconnect = await t.fetch("/api/agent-connections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-connection-id": first.agentConnectionId,
        "x-agent-connection-secret": first.agentConnectionSecret,
      },
      body: "{}",
    });
    expect(staleReconnect.status).toBe(400);

    const revoke = await t.fetch("/api/agent-connections/revoke", {
      method: "POST",
      headers: {
        "x-agent-connection-id": replacement.agentConnectionId,
        "x-agent-connection-secret": replacement.agentConnectionSecret,
      },
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toEqual({ ok: true, status: "revoked" });
  });

  test("an agent can cancel its unapproved connection invite", async () => {
    const t = convexTest(schema, modules);
    const inviteResponse = await t.fetch("/api/agent-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "Disposable" }),
    });
    const invite = await inviteResponse.json();
    const cancel = await t.fetch("/api/agent-connections/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: invite.claimHandle }),
    });
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toEqual({ status: "cancelled" });

    const claim = await t.fetch("/api/agent-connections/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: invite.claimHandle }),
    });
    expect(claim.status).toBe(403);
  });

  test("pairing binds requests to one Scope account, claims once, and revocation is a kill switch", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "owner@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const other = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "other@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const ownerSession = t.withIdentity({ subject: `${owner}|session` });
    const otherSession = t.withIdentity({ subject: `${other}|session` });

    const inviteResponse = await t.fetch("/api/agent-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "Codex" }),
    });
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json();
    const publicToken = invite.connectUrl.split("/connect/")[1];

    const pendingClaim = await t.fetch("/api/agent-connections/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: invite.claimHandle }),
    });
    expect(pendingClaim.status).toBe(202);

    await ownerSession.mutation(api.tables.agentConnections.decideInvite, {
      publicToken,
      decision: "approved",
    });
    expect(
      await otherSession.query(api.tables.agentConnections.getInvite, {
        publicToken,
      }),
    ).toBeNull();

    const claimResponse = await t.fetch("/api/agent-connections/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: invite.claimHandle }),
    });
    expect(claimResponse.status).toBe(200);
    const claimed = await claimResponse.json();
    expect(claimed.agentConnectionSecret).toMatch(/^acs_/);

    const replay = await t.fetch("/api/agent-connections/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: invite.claimHandle }),
    });
    expect(replay.status).toBe(403);

    await t.mutation(internal.tables.connections.mutations.saveConnection, {
      userId: owner,
      provider: "github",
      app: "github",
      accessToken: "standing",
      login: "octocat",
      providerUserId: "1",
    });
    const account = (
      await ownerSession.query(api.tables.connections.queries.statusesForApps, {
        apps: ["github"],
      })
    )[0].accounts[0].id;
    const createdResponse = await t.fetch("/api/access-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-connection-id": claimed.agentConnectionId,
        "x-agent-connection-secret": claimed.agentConnectionSecret,
      },
      body: JSON.stringify({
        apps: ["github"],
        ttlMs: 60_000,
        reason: "Test owner binding",
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    const requestToken = created.approvalUrl.split("/requests/new/")[1];
    expect(
      await otherSession.query(api.tables.slices.sliceRequests.get, {
        publicToken: requestToken,
      }),
    ).toBeNull();

    await ownerSession.mutation(api.tables.slices.sliceRequests.decide, {
      publicToken: requestToken,
      decision: "approved",
      bindings: [{ app: "github", connectionId: account }],
    });
    const sliceResponse = await t.fetch("/api/access-requests/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: created.claimHandle }),
    });
    const slice = await sliceResponse.json();
    expect(
      await ownerSession.query(api.tables.agentConnections.list, {}),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: claimed.agentConnectionId,
          slices: expect.arrayContaining([
            expect.objectContaining({ _id: slice.sliceId, status: "active" }),
          ]),
        }),
      ]),
    );

    await ownerSession.mutation(api.tables.agentConnections.revoke, {
      agentConnectionId: claimed.agentConnectionId,
    });
    const afterRevoke = await t.fetch("/api/access-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-connection-id": claimed.agentConnectionId,
        "x-agent-connection-secret": claimed.agentConnectionSecret,
      },
      body: JSON.stringify({
        apps: ["github"],
        ttlMs: 60_000,
        reason: "Test revocation",
      }),
    });
    expect(afterRevoke.status).toBe(401);

    const useRevokedSlice = await t.fetch("/api/accounts?app=github", {
      method: "GET",
      headers: {
        "x-slice-token": slice.sliceToken,
        "x-slice-secret": slice.sliceSecret,
      },
    });
    expect(useRevokedSlice.status).toBe(401);
  });
});
