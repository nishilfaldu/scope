/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

describe("agent connections", () => {
  test("pairing binds requests to one passport, claims once, and revocation is a kill switch", async () => {
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
      body: JSON.stringify({ apps: ["github"], ttlMs: 60_000 }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    const requestToken = created.approvalUrl.split("/requests/new/")[1];
    expect(
      await otherSession.query(api.tables.slices.accessRequests.getNewSlice, {
        publicToken: requestToken,
      }),
    ).toBeNull();

    await ownerSession.mutation(api.tables.slices.accessRequests.decide, {
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
      body: JSON.stringify({ apps: ["github"], ttlMs: 60_000 }),
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
