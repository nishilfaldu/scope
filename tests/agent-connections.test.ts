/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

afterEach(() => vi.useRealTimers());

describe("agent connections", () => {
  test.each(["activate first", "revoke first"])(
    "owner revocation wins when rotation and revocation commit in either order: %s",
    async (order) => {
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
      const firstInvite = await t.mutation(
        internal.tables.agentConnections.createInvite,
        {
          agentName: "Codex",
        },
      );
      await ownerSession.mutation(api.tables.agentConnections.decideInvite, {
        publicToken: firstInvite.publicToken,
        decision: "approved",
      });
      const first = await t.mutation(internal.tables.agentConnections.claim, {
        claimHandle: firstInvite.claimHandle,
      });
      if (first.kind !== "connected") throw new Error("Expected connection");
      expect(
        await t.mutation(internal.tables.agentConnections.acknowledgeClaim, {
          claimHandle: firstInvite.claimHandle,
          agentConnectionSecret: first.agentConnectionSecret,
        }),
      ).toMatchObject({ ok: true, resourceStatus: "active" });
      const sliceId = await t.run((ctx) =>
        ctx.db.insert("slices", {
          userId: owner,
          agentId: first.agentId,
          name: "Existing grant",
          token: "st_existing",
          secretHash: "unused",
          status: "active",
          expiresAt: Date.now() + 60_000,
          mintPolicy: "auto",
        }),
      );
      const replacementInvite = await t.mutation(
        internal.tables.agentConnections.createInvite,
        {
          agentName: "Codex",
          previousConnectionId: first.agentConnectionId,
          previousConnectionSecret: first.agentConnectionSecret,
        },
      );
      await ownerSession.mutation(api.tables.agentConnections.decideInvite, {
        publicToken: replacementInvite.publicToken,
        decision: "approved",
      });
      const replacement = await t.mutation(
        internal.tables.agentConnections.claim,
        {
          claimHandle: replacementInvite.claimHandle,
        },
      );
      if (replacement.kind !== "connected")
        throw new Error("Expected replacement");
      const activate = () =>
        t.mutation(internal.tables.agentConnections.activateReplacement, {
          agentConnectionId: replacement.agentConnectionId,
          agentConnectionSecret: replacement.agentConnectionSecret,
        });
      const revoke = () =>
        ownerSession.mutation(api.tables.agentConnections.revoke, {
          agentConnectionId: first.agentConnectionId,
        });
      if (order === "activate first") {
        expect((await activate()).ok).toBe(true);
        await revoke();
      } else {
        await revoke();
        expect((await activate()).ok).toBe(false);
      }
      await revoke();
      await expect(
        otherSession.mutation(api.tables.agentConnections.revoke, {
          agentConnectionId: first.agentConnectionId,
        }),
      ).rejects.toThrow("not found");
      const active = await t.run((ctx) =>
        ctx.db
          .query("agentConnections")
          .withIndex("by_agentId_status", (q) =>
            q.eq("agentId", first.agentId).eq("status", "active"),
          )
          .take(2),
      );
      expect(active).toHaveLength(0);
      expect(
        await ownerSession.query(api.tables.slices.queries.get, {
          sliceId,
        }),
      ).toMatchObject({ status: "revoked" });
      await expect(
        t.mutation(internal.tables.agentConnections.createInvite, {
          agentName: "Codex",
          previousConnectionId: replacement.agentConnectionId,
          previousConnectionSecret: replacement.agentConnectionSecret,
        }),
      ).rejects.toThrow("Agent connection revoked");
      const request = await t.fetch("/api/access-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-connection-id": replacement.agentConnectionId,
          "x-agent-connection-secret": replacement.agentConnectionSecret,
        },
        body: JSON.stringify({
          apps: ["github"],
          ttlMs: 60_000,
          reason: "Denied",
        }),
      });
      expect(request.status).toBe(403);
    },
  );
  test("rotation keeps the old connection live until idempotent activation", async () => {
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
    const firstAck = await t.fetch("/api/agent-connections/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimHandle: firstInvite.claimHandle,
        agentConnectionSecret: first.agentConnectionSecret,
      }),
    });
    expect(firstAck.status).toBe(200);
    const lineageRecords = await t.run(async (ctx) => {
      const sliceId = await ctx.db.insert("slices", {
        userId: owner,
        agentId: first.agentId,
        name: "Existing grant",
        token: "st_existing_grant",
        secretHash: "slice-secret-hash",
        status: "active",
        expiresAt: Date.now() + 60_000,
        mintPolicy: "auto",
      });
      const requestId = await ctx.db.insert("sliceRequests", {
        publicToken: "ar_existing_request",
        claimSecretHash: "claim-secret-hash",
        agentId: first.agentId,
        apps: ["github"],
        ttlMs: 60_000,
        reason: "Existing request",
        status: "pending",
        approvalDeadlineAt: Date.now() + 60_000,
      });
      return { sliceId, requestId };
    });

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
    expect(replacement.activationRequired).toBe(true);

    const replayedClaim = await t.fetch("/api/agent-connections/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: reconnect.claimHandle }),
    });
    expect(await replayedClaim.json()).toMatchObject({
      agentConnectionId: replacement.agentConnectionId,
      agentConnectionSecret: replacement.agentConnectionSecret,
    });

    const beforeActivation = await t.run((ctx) =>
      ctx.db.get("agentConnections", first.agentConnectionId),
    );
    expect(beforeActivation?.status).toBe("active");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const activation = await t.fetch("/api/agent-connections/activate", {
        method: "POST",
        headers: {
          "x-agent-connection-id": replacement.agentConnectionId,
          "x-agent-connection-secret": replacement.agentConnectionSecret,
        },
      });
      expect(activation.status).toBe(200);
      expect(await activation.json()).toMatchObject({
        ok: true,
        status: "active",
      });
    }
    const activatedStatus = await t.fetch("/api/agent-connections/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: reconnect.claimHandle }),
    });
    expect(await activatedStatus.json()).toMatchObject({
      handoffStatus: "ready",
      resourceStatus: "active",
    });

    const connections = await t.run((ctx) =>
      ctx.db
        .query("agentConnections")
        .withIndex("by_agentId_status", (q) => q.eq("agentId", first.agentId))
        .collect(),
    );
    expect(connections.every((connection) => connection.userId === owner)).toBe(
      true,
    );
    expect(
      connections.filter((connection) => connection.status === "active"),
    ).toHaveLength(1);
    expect(
      connections.find(
        (connection) => connection._id === first.agentConnectionId,
      )?.status,
    ).toBe("revoked");
    const unchangedLineageRecords = await t.run(async (ctx) => ({
      slice: await ctx.db.get("slices", lineageRecords.sliceId),
      request: await ctx.db.get("sliceRequests", lineageRecords.requestId),
    }));
    expect(unchangedLineageRecords.slice).toMatchObject({
      agentId: first.agentId,
    });
    expect(unchangedLineageRecords.request).toMatchObject({
      agentId: first.agentId,
    });
    expect(unchangedLineageRecords.slice).not.toHaveProperty(
      "agentConnectionId",
    );
    expect(unchangedLineageRecords.request).not.toHaveProperty(
      "agentConnectionId",
    );

    const staleReconnect = await t.fetch("/api/agent-connections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-connection-id": first.agentConnectionId,
        "x-agent-connection-secret": first.agentConnectionSecret,
      },
      body: "{}",
    });
    expect(staleReconnect.status).toBe(403);

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

  test("an expired unactivated rotation leaves the current connection active", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "owner@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const ownerSession = t.withIdentity({ subject: `${owner}|session` });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const inviteResponse = await t.fetch("/api/agent-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "Codex" }),
    });
    const invite = await inviteResponse.json();
    await ownerSession.mutation(api.tables.agentConnections.decideInvite, {
      publicToken: invite.connectUrl.split("/connect/")[1],
      decision: "approved",
    });
    const firstClaim = await t.fetch("/api/agent-connections/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: invite.claimHandle }),
    });
    const current = await firstClaim.json();
    const acknowledged = await t.fetch("/api/agent-connections/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimHandle: invite.claimHandle,
        agentConnectionSecret: current.agentConnectionSecret,
      }),
    });
    expect(acknowledged.status).toBe(200);

    const reconnectResponse = await t.fetch("/api/agent-connections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-connection-id": current.agentConnectionId,
        "x-agent-connection-secret": current.agentConnectionSecret,
      },
      body: "{}",
    });
    const reconnect = await reconnectResponse.json();
    await ownerSession.mutation(api.tables.agentConnections.decideInvite, {
      publicToken: reconnect.connectUrl.split("/connect/")[1],
      decision: "approved",
    });
    const replacementClaim = await t.fetch("/api/agent-connections/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: reconnect.claimHandle }),
    });
    const replacement = await replacementClaim.json();

    await t.finishAllScheduledFunctions(() =>
      vi.advanceTimersByTime(15 * 60 * 1000 + 1),
    );

    expect(
      await ownerSession.query(api.tables.agentDashboard.list, {}),
    ).toMatchObject([
      {
        _id: current.agentConnectionId,
        status: "active",
        agentId: current.agentId,
        name: "Codex",
      },
    ]);
    const activation = await t.fetch("/api/agent-connections/activate", {
      method: "POST",
      headers: {
        "x-agent-connection-id": replacement.agentConnectionId,
        "x-agent-connection-secret": replacement.agentConnectionSecret,
      },
    });
    expect(activation.status).toBe(403);
  });

  test("the owner can reconnect a credential-less agent to an active lineage", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "owner@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const ownerSession = t.withIdentity({ subject: `${owner}|session` });
    const currentId = await t.run((ctx) =>
      ctx.db.insert("agentConnections", {
        userId: owner,
        agentId: "ag_existing",
        name: "Codex",
        secretHash: "unavailable-old-secret",
        status: "active",
      }),
    );
    const inviteResponse = await t.fetch("/api/agent-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "Fresh Codex install" }),
    });
    const invite = await inviteResponse.json();
    const publicToken = invite.connectUrl.split("/connect/")[1];
    const view = await ownerSession.query(
      api.tables.agentConnections.getInvite,
      { publicToken },
    );
    expect(view?.replacementOptions).toContainEqual({
      id: currentId,
      name: "Codex",
    });
    await ownerSession.mutation(api.tables.agentConnections.decideInvite, {
      publicToken,
      decision: "approved",
      replaceAgentConnectionId: currentId,
    });
    const claim = await t.fetch("/api/agent-connections/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: invite.claimHandle }),
    });
    const replacement = await claim.json();
    expect(replacement).toMatchObject({
      agentId: "ag_existing",
      agentName: "Codex",
      activationRequired: true,
    });
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
    expect(replay.status).toBe(200);
    expect((await replay.json()).agentConnectionSecret).toBe(
      claimed.agentConnectionSecret,
    );
    const ack = await t.fetch("/api/agent-connections/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimHandle: invite.claimHandle,
        agentConnectionSecret: claimed.agentConnectionSecret,
      }),
    });
    expect(ack.status).toBe(200);

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
    const sliceAck = await t.fetch("/api/access-requests/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimHandle: created.claimHandle,
        sliceSecret: slice.sliceSecret,
      }),
    });
    expect(sliceAck.status).toBe(200);
    expect(
      await ownerSession.query(api.tables.agentDashboard.list, {}),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: claimed.agentConnectionId,
        }),
      ]),
    );
    const grants = await ownerSession.query(
      api.tables.agentDashboard.grantsPage,
      {
        agentConnectionId: claimed.agentConnectionId,
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(grants.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: slice.sliceId, status: "active" }),
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
    expect(afterRevoke.status).toBe(403);

    const useRevokedSlice = await t.fetch("/api/accounts?app=github", {
      method: "GET",
      headers: {
        "x-slice-token": slice.sliceToken,
        "x-slice-secret": slice.sliceSecret,
      },
    });
    expect(useRevokedSlice.status).toBe(403);
  });
});
