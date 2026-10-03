// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { SLACK_SCOPES } from "../convex/connect/contracts";
import { POST } from "../app/api/connect/bridge/route";
import type { ConnectTokenResponse, ConnectorMetadata } from "@vercel/connect";
import * as sdk from "@vercel/connect";

vi.mock("@vercel/connect", () => ({
  getConnectorMetadata: vi.fn(),
  getTokenResponse: vi.fn(),
  startAuthorization: vi.fn(),
  revokeToken: vi.fn(),
}));
const modules = import.meta.glob("../convex/**/*.ts");
const setup = () => convexTest(schema, modules);
const site = "https://scope.convex.site";
const board = "https://scope.example.com";
const bridge = `${board}/api/connect/bridge`;
const json = (body: unknown, headers = {}) => Response.json(body, { headers });
const connector: ConnectorMetadata = {
  id: "scl_slack",
  uid: "slack/scope",
  name: "Scope",
  type: "slack",
  service: "slack",
  createdAt: 1,
  updatedAt: 1,
  vendor: {},
};
const providerToken = (team = "T1", user = "U1"): ConnectTokenResponse => ({
  token: `xoxe.xoxp-${team}-${user}`,
  expiresAt: Date.now() + 3600_000,
  connector,
  installationId: `inst_${team}`,
});
let backend: ReturnType<typeof setup>;
let upstreamScopes: string[];
let upstreamBot: boolean;
let upstreamFailure: boolean;
let duringToken: (() => Promise<void>) | undefined;

beforeEach(() => {
  backend = setup();
  upstreamScopes = ["chat:write", "channels:read"];
  upstreamBot = false;
  upstreamFailure = false;
  duringToken = undefined;
  vi.stubEnv("CONNECT_BRIDGE_URL", bridge);
  vi.stubEnv(
    "CONNECT_BRIDGE_SECRET",
    "test-secret-with-at-least-32-characters",
  );
  vi.stubEnv("CONNECT_SLACK_CONNECTOR", connector.uid);
  vi.stubEnv("CONVEX_SITE_URL", site);
  vi.stubEnv("BOARD_ORIGIN", board);
  vi.stubEnv("SCOPE_CONVEX_SITE_URL", site);
  vi.stubEnv("SCOPE_BOARD_ORIGIN", board);
  vi.mocked(sdk.getConnectorMetadata).mockResolvedValue(connector);
  vi.mocked(sdk.getTokenResponse).mockResolvedValue(providerToken());
  vi.mocked(sdk.startAuthorization).mockResolvedValue({
    request: "request",
    verifier: "verifier",
    url: "https://vercel.com/connect/authorize",
  });
  vi.mocked(sdk.revokeToken).mockResolvedValue();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === bridge) {
      if (duringToken) {
        const hook = duringToken;
        duringToken = undefined;
        await hook();
      }
      return await POST(new Request(url, init));
    }
    if (url === `${site}/api/connect/ticket`)
      return await backend.fetch("/api/connect/ticket", init);
    if (url === "https://slack.com/api/auth.test") {
      const token = new Headers(init?.headers).get("authorization")!;
      const parts = token.split("-");
      return json(
        {
          ok: !upstreamFailure,
          team_id: parts.at(-2),
          user_id: parts.at(-1),
          team: parts.at(-2),
          user: parts.at(-1),
          ...(upstreamBot ? { bot_id: "B1" } : {}),
        },
        { "x-oauth-scopes": upstreamScopes.join(",") },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
async function owner() {
  const id = await backend.run((ctx) =>
    ctx.db.insert("users", { name: "Owner" }),
  );
  return { id, client: backend.withIdentity({ subject: `${id}|session` }) };
}
async function connect(
  ownerClient: ReturnType<typeof backend.withIdentity>,
  team = "T1",
  user = "U1",
) {
  const pending = await ownerClient.mutation(
    api.tables.oauthStates.mutations.start,
    { app: "slack", returnTo: `${board}/connections` },
  );
  const started = await backend.fetch(
    `/api/slack/connect?state=${pending.state}`,
  );
  expect(started.status).toBe(302);
  vi.mocked(sdk.getTokenResponse).mockResolvedValue(providerToken(team, user));
  const finished = await ownerClient.action(
    api.tables.oauthStates.finish.complete,
    { ...pending, app: "slack", code: "connect" },
  );
  expect(finished.connected).toBe(true);
  return (
    await ownerClient.query(api.tables.connections.queries.statusesForApps, {
      apps: ["slack"],
    })
  )[0].accounts.find((a) => a.providerUserId === `${team}:${user}`)!;
}
async function slice(
  client: ReturnType<typeof backend.withIdentity>,
  connectionIds: string[],
  mintPolicy: "auto" | "approve" = "auto",
) {
  const ids = await backend.run((ctx) =>
    connectionIds.map((id) => ctx.db.normalizeId("connections", id)!),
  );
  return await client.mutation(internal.tables.slices.mutations.createFixture, {
    name: "Slack agent",
    apps: ["slack"],
    bindings: ids.map((connectionId) => ({ app: "slack", connectionId })),
    ttlMs: 60_000,
    mintPolicy,
  });
}
function credential(
  created: { sliceToken: string; sliceSecret: string },
  bindingId?: string,
) {
  return backend.fetch("/api/credentials", {
    method: "POST",
    body: JSON.stringify({
      sliceToken: created.sliceToken,
      sliceSecret: created.sliceSecret,
      app: "slack",
      bindingId,
    }),
  });
}

describe("Slack Connect end to end with mocked Vercel and Slack", () => {
  test("authorize -> verify -> bind -> mint keeps only references and provider expiry", async () => {
    const user = await owner();
    const account = await connect(user.client);
    expect(sdk.startAuthorization).toHaveBeenCalledWith(
      connector.id,
      expect.objectContaining({
        subject: {
          type: "user",
          id: expect.stringContaining(`scope:${user.id}:`),
          issuer: site,
        },
        scopes: SLACK_SCOPES,
      }),
      expect.objectContaining({
        callbackUrl: expect.stringContaining(
          "/oauth/complete?app=slack&state=",
        ),
      }),
    );
    const row = await backend.run((ctx) =>
      ctx.db.get("connections", account.id),
    );
    expect(row).toMatchObject({
      backend: "vercel-connect",
      providerUserId: "T1:U1",
      connect: { installationId: "inst_T1" },
    });
    for (const obsolete of [
      "accessToken",
      "refreshToken",
      "tokenExpiresAt",
      "refreshLease",
      "refreshLeaseExpiresAt",
    ])
      expect(row).not.toHaveProperty(obsolete);
    const created = await slice(user.client, [account.id]);
    const response = await credential(created);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      accessToken: "xoxe.xoxp-T1-U1",
      credentialExpiresAt: expect.any(Number),
      tokenType: "Bearer",
    });
    expect(result.credentialExpiresAt).toBeGreaterThan(Date.now() + 60_000);
    expect(result).not.toHaveProperty("refreshToken");
    expect(sdk.getTokenResponse).toHaveBeenLastCalledWith(
      connector.id,
      expect.objectContaining({
        installationId: "inst_T1",
        scopes: SLACK_SCOPES,
      }),
      { forceRefresh: true },
    );
    expect(
      await backend.run((ctx) =>
        ctx.db.query("connectBridgeTickets").collect(),
      ),
    ).toEqual([]);
    expect(
      await backend.query(internal.tables.connections.queries.getConnection, {
        userId: user.id,
        app: "slack",
        connectionId: account.id,
      }),
    ).toBeNull();
  });

  test("another Scope user cannot complete, bind, read, or disconnect the owner's account", async () => {
    const a = await owner(),
      b = await owner();
    const pending = await a.client.mutation(
      api.tables.oauthStates.mutations.start,
      { app: "slack", returnTo: `${board}/connections` },
    );
    await expect(
      b.client.action(api.tables.oauthStates.finish.complete, {
        ...pending,
        app: "slack",
        code: "connect",
      }),
    ).rejects.toThrow("mismatch");
    const account = await connect(a.client);
    expect(
      (
        await b.client.query(api.tables.connections.queries.statusesForApps, {
          apps: ["slack"],
        })
      )[0].accounts,
    ).toEqual([]);
    await expect(slice(b.client, [account.id])).rejects.toThrow();
    expect(
      await backend.query(internal.connect.connections.get, {
        userId: b.id,
        connectionId: account.id,
      }),
    ).toBeNull();
    await b.client.action(api.tables.connections.actions.disconnect, {
      app: "slack",
      connectionId: account.id,
    });
    expect(sdk.revokeToken).not.toHaveBeenCalled();
    expect(
      await backend.run((ctx) => ctx.db.get("connections", account.id)),
    ).not.toBeNull();
  });

  test("browser proof, app mismatch, expiry, and callback replay cannot authorize", async () => {
    const a = await owner();
    const pending = await a.client.mutation(
      api.tables.oauthStates.mutations.start,
      { app: "slack", returnTo: `${board}/connections` },
    );
    await expect(
      a.client.action(api.tables.oauthStates.finish.complete, {
        ...pending,
        browserProof: "wrong",
        app: "slack",
        code: "connect",
      }),
    ).rejects.toThrow("mismatch");
    expect(
      (await backend.fetch(`/api/gmail/connect?state=${pending.state}`)).status,
    ).toBe(400);
    await a.client.action(api.tables.oauthStates.finish.complete, {
      ...pending,
      app: "slack",
      code: "connect",
    });
    await expect(
      a.client.action(api.tables.oauthStates.finish.complete, {
        ...pending,
        app: "slack",
        code: "connect",
      }),
    ).rejects.toThrow("mismatch");
    const expired = await a.client.mutation(
      api.tables.oauthStates.mutations.start,
      { app: "slack", returnTo: `${board}/connections` },
    );
    await backend.run(async (ctx) => {
      const row = await ctx.db
        .query("oauthStates")
        .withIndex("by_state", (q) => q.eq("state", expired.state))
        .unique();
      await ctx.db.patch("oauthStates", row!._id, { expiresAt: 0 });
    });
    expect(
      (await backend.fetch(`/api/slack/connect?state=${expired.state}`)).status,
    ).toBe(400);
  });

  test("two workspaces require account selection; mint remains pinned if the default changes", async () => {
    const user = await owner();
    const a = await connect(user.client, "T1", "U1"),
      b = await connect(user.client, "T2", "U1");
    const created = await slice(user.client, [a.id, b.id]);
    const accounts = await backend.query(
      internal.tables.slices.queries.discoverAccounts,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
        now: Date.now(),
      },
    );
    if (!accounts.ok) throw new Error("Discovery failed");
    expect(accounts.accounts).toHaveLength(2);
    expect((await credential(created)).status).toBe(409);
    const selected = accounts.accounts.find((a) => a.login === "U1 (T2)")!;
    expect((await credential(created, selected.bindingId)).status).toBe(200);
    vi.mocked(sdk.getTokenResponse).mockResolvedValue(
      providerToken("T1", "U1"),
    );
    const denied = await credential(created, selected.bindingId);
    expect(denied.status).toBe(503);
    expect(await denied.text()).not.toContain("xoxe");
  });

  test("approve policy consumes only the selected approved request once", async () => {
    const user = await owner(),
      account = await connect(user.client);
    const created = await slice(user.client, [account.id], "approve");
    sdk.getTokenResponse.mockClear();
    const pending = await credential(created);
    expect(pending.status).toBe(202);
    expect(sdk.getTokenResponse).not.toHaveBeenCalled();
    const request = await pending.json();
    const poll = () =>
      backend.fetch("/api/credentials/claim", {
        method: "POST",
        body: JSON.stringify({
          sliceToken: created.sliceToken,
          sliceSecret: created.sliceSecret,
          requestId: request.requestId,
        }),
      });
    expect((await poll()).status).toBe(202);
    await user.client.mutation(api.tables.slices.tokenRequests.decide, {
      publicToken: new URL(request.approvalUrl).pathname.split("/").at(-1)!,
      decision: "approved",
    });
    expect((await poll()).status).toBe(200);
    expect((await poll()).status).toBe(403);
  });

  test.each(["revoke", "expire", "binding", "disconnect", "reconnect"])(
    "%s during issuance prevents token delivery",
    async (reason) => {
      const user = await owner(),
        account = await connect(user.client);
      const created = await slice(user.client, [account.id]);
      duringToken = async () => {
        await backend.run(async (ctx) => {
          if (reason === "revoke")
            await ctx.db.patch("slices", created.id, { status: "revoked" });
          if (reason === "expire")
            await ctx.db.patch("slices", created.id, { expiresAt: 0 });
          if (reason === "disconnect")
            await ctx.db.delete("connections", account.id);
          if (reason === "reconnect") {
            const row = await ctx.db.get("connections", account.id);
            await ctx.db.patch("connections", account.id, {
              grantVersion: row!.grantVersion + 1,
            });
          }
          if (reason === "binding") {
            const binding = await ctx.db
              .query("sliceBindings")
              .withIndex("by_slice_app_connectionId", (q) =>
                q.eq("sliceId", created.id),
              )
              .unique();
            await ctx.db.delete("sliceBindings", binding!._id);
          }
        });
      };
      const response = await credential(created);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("xoxe");
    },
  );

  test("disconnect commits locally even when upstream revocation fails, and targets only its subject/installation", async () => {
    const user = await owner(),
      account = await connect(user.client);
    const created = await slice(user.client, [account.id]);
    vi.mocked(sdk.revokeToken).mockRejectedValue(new Error("vendor secret"));
    await user.client.action(api.tables.connections.actions.disconnect, {
      app: "slack",
      connectionId: account.id,
    });
    expect(sdk.revokeToken).toHaveBeenCalledWith(connector.id, {
      subject: {
        type: "user",
        id: expect.stringContaining(`scope:${user.id}:`),
        issuer: site,
      },
      installationId: "inst_T1",
    });
    expect((await credential(created)).status).toBe(403);
    expect(
      await backend.run((ctx) => ctx.db.get("connections", account.id)),
    ).toBeNull();
  });
});

describe("migration cleanup and isolation", () => {
  test("replaces a verified matching legacy row, removes secrets/leases, and rejects late refresh", async () => {
    const user = await owner();
    await backend.mutation(
      internal.tables.connections.mutations.saveConnection,
      {
        userId: user.id,
        app: "slack",
        provider: "slack",
        providerUserId: "T1:U1",
        login: "legacy",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        tokenExpiresAt: Date.now() + 3600_000,
      },
    );
    const old = await backend.run((ctx) =>
      ctx.db.query("connections").unique(),
    );
    expect(
      await backend.mutation(
        internal.tables.connections.mutations.beginRefresh,
        {
          userId: user.id,
          app: "slack",
          connectionId: old!._id,
          grantVersion: old!.grantVersion,
          lease: "old-lease",
        },
      ),
    ).toBe(true);
    const account = await connect(user.client);
    expect(account.id).toBe(old!._id);
    const row = await backend.run((ctx) =>
      ctx.db.get("connections", account.id),
    );
    for (const field of [
      "accessToken",
      "refreshToken",
      "tokenExpiresAt",
      "refreshLease",
      "refreshLeaseExpiresAt",
    ])
      expect(row).not.toHaveProperty(field);
    expect(
      await backend.mutation(
        internal.tables.connections.mutations.refreshConnection,
        {
          userId: user.id,
          app: "slack",
          connectionId: account.id,
          providerUserId: "T1:U1",
          grantVersion: old!.grantVersion,
          lease: "old-lease",
          accessToken: "late-access",
        },
      ),
    ).toBe(false);
    await expect(
      backend.mutation(internal.tables.connections.mutations.saveConnection, {
        userId: user.id,
        app: "slack",
        provider: "slack",
        providerUserId: "T1:U1",
        login: "late callback",
        accessToken: "old-access",
      }),
    ).rejects.toThrow("Vercel Connect");
  });
  test("two Scope owners authorizing the same Slack user receive distinct subjects", async () => {
    const a = await owner(),
      b = await owner();
    const accountA = await connect(a.client),
      accountB = await connect(b.client);
    const rowA = await backend.query(internal.connect.connections.get, {
      userId: a.id,
      connectionId: accountA.id,
    });
    const rowB = await backend.query(internal.connect.connections.get, {
      userId: b.id,
      connectionId: accountB.id,
    });
    expect(rowA!.connect.subjectId).not.toBe(rowB!.connect.subjectId);
    await a.client.action(api.tables.connections.actions.disconnect, {
      app: "slack",
      connectionId: accountA.id,
    });
    expect(sdk.revokeToken).toHaveBeenCalledWith(connector.id, {
      subject: { type: "user", id: rowA!.connect.subjectId, issuer: site },
      installationId: "inst_T1",
    });
    const createdB = await slice(b.client, [accountB.id]);
    expect((await credential(createdB)).status).toBe(200);
  });
  test("reconnecting preserves bindings, replaces the reference, and fences stale delivery", async () => {
    const user = await owner(),
      account = await connect(user.client);
    const created = await slice(user.client, [account.id]);
    const old = await backend.query(internal.connect.connections.get, {
      userId: user.id,
      connectionId: account.id,
    });
    const binding = await backend.run((ctx) =>
      ctx.db.query("sliceBindings").unique(),
    );
    const reconnected = await connect(user.client);
    expect(reconnected.id).toBe(account.id);
    expect(sdk.revokeToken).not.toHaveBeenCalled();
    const denied = await backend.mutation(
      internal.tables.slices.credentials.finalize,
      {
        sliceId: created.id,
        app: "slack",
        bindingId: binding!._id,
        connectionId: account.id,
        connectionGrantVersion: old!.grantVersion,
      },
    );
    expect(denied).toMatchObject({ ok: false, code: "APP_UNAVAILABLE" });
    expect((await credential(created)).status).toBe(200);
  });
});

describe("authenticated, one-use bridge commands", () => {
  const body = { ticket: `cb_${"a".repeat(64)}` };
  const bridgeRequest = (
    payload: unknown,
    authorization = "Bearer test-secret-with-at-least-32-characters",
  ) =>
    new Request(bridge, {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify(payload),
    });
  test("rejects missing authentication, unknown ticket, and caller identity/scopes", async () => {
    expect((await POST(bridgeRequest(body, "Bearer wrong"))).status).toBe(401);
    expect((await POST(bridgeRequest(body))).status).toBe(403);
    expect(
      (
        await POST(
          bridgeRequest({ ...body, subject: { type: "user", id: "victim" } }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          bridgeRequest({ ...body, connector: "other", scopes: ["*"] }),
        )
      ).status,
    ).toBe(400);
    expect(sdk.getTokenResponse).not.toHaveBeenCalled();
  });
  test("ticket resolution rejects unauthenticated requests, replay, and expired tickets", async () => {
    const ticket = await backend.mutation(internal.connect.tickets.issue, {
      command: {
        operation: "token",
        subjectId: "scope:owner:slot",
        issuer: site,
      },
    });
    const invoke = (secret: string) =>
      backend.fetch("/api/connect/ticket", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: JSON.stringify({ ticket }),
      });
    expect((await invoke("wrong")).status).toBe(401);
    expect(
      (await invoke("test-secret-with-at-least-32-characters")).status,
    ).toBe(200);
    expect(
      (await invoke("test-secret-with-at-least-32-characters")).status,
    ).toBe(403);
    const expired = await backend.mutation(internal.connect.tickets.issue, {
      command: {
        operation: "token",
        subjectId: "scope:owner:slot",
        issuer: site,
      },
    });
    await backend.run(async (ctx) => {
      const row = await ctx.db.query("connectBridgeTickets").unique();
      await ctx.db.patch("connectBridgeTickets", row!._id, { expiresAt: 0 });
    });
    expect((await POST(bridgeRequest({ ticket: expired }))).status).toBe(403);
  });
  test.each([
    "custom",
    "bot",
    "unknownScopes",
    "excessScopes",
    "standing",
    "unrotated",
    "missingInstallation",
    "noAuthorization",
    "expired",
    "wrongConnector",
    "wrongUser",
    "wrongTenant",
    "wrongExternalSubject",
    "wildcard",
    "providerFailure",
  ])("fails closed for %s", async (problem) => {
    if (problem === "custom")
      vi.mocked(sdk.getConnectorMetadata).mockResolvedValue({
        ...connector,
        type: "oauth",
      });
    if (problem === "bot") upstreamBot = true;
    if (problem === "unknownScopes") upstreamScopes = [];
    if (problem === "excessScopes")
      upstreamScopes = ["chat:write", "admin.users:write"];
    if (problem === "providerFailure") upstreamFailure = true;
    const token = providerToken();
    if (problem === "standing") token.expiresAt = Number.MAX_SAFE_INTEGER;
    if (problem === "unrotated") token.token = "xoxp-standing";
    if (problem === "missingInstallation") delete token.installationId;
    if (problem === "expired") token.expiresAt = 0;
    if (problem === "wrongConnector")
      token.connector = { ...connector, id: "scl_other" };
    if (problem === "wildcard") token.installationId = "*";
    if (problem === "wrongTenant") token.tenantId = "T2";
    if (problem === "wrongExternalSubject") token.externalSubject = "U2";
    vi.mocked(sdk.getTokenResponse).mockResolvedValue(token);
    if (problem === "noAuthorization")
      vi.mocked(sdk.getTokenResponse).mockRejectedValue(
        new Error("user_authorization_required"),
      );
    const ticket = await backend.mutation(internal.connect.tickets.issue, {
      command: {
        operation: "token",
        subjectId: "scope:owner:slot",
        issuer: site,
        providerUserId: problem === "wrongUser" ? "T2:U2" : "T1:U1",
      },
    });
    const result = await POST(bridgeRequest({ ticket }));
    expect([403, 503]).toContain(result.status);
    expect(await result.text()).not.toContain("xoxe");
  });
});
