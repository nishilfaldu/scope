/// <reference types="vite/client" />
// @vitest-environment node
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import {
  CONNECT_SLACK_SCOPES as SLACK_SCOPES,
  slackScopesAreBounded,
} from "../convex/connect/contracts";
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

test("managed Slack accepts its implicit identity permission but rejects unsupported legacy scopes", () => {
  expect(slackScopesAreBounded(["identify", ...SLACK_SCOPES])).toBe(true);
  for (const scope of [
    "search:read",
    "bookmarks:read",
    "bookmarks:write",
    "admin",
  ]) {
    expect(slackScopesAreBounded([...SLACK_SCOPES, scope])).toBe(false);
  }
});

test("preview protection credential goes only to the configured bridge", async () => {
  vi.stubEnv("CONNECT_BRIDGE_PROTECTION_COOKIE", "preview-only-secret");
  const user = await owner();
  await connect(user.client);
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls.some(([input]) => String(input) === bridge)).toBe(true);
  for (const [input, init] of calls) {
    expect(new Headers(init?.headers).get("Cookie")).toBe(
      String(input) === bridge ? "preview-only-secret" : null,
    );
  }
});
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
describe("Slack Connect end to end with mocked Vercel and Slack", () => {
  test("authorize -> verify -> bind stores references without provider credentials", async () => {
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
    await b.client.action(api.tables.connections.actions.disconnect, {
      app: "slack",
      connectionId: account.id,
    });
    expect(sdk.revokeToken).not.toHaveBeenCalled();
    expect(
      await backend.run((ctx) => ctx.db.get("connections", account.id)),
    ).not.toBeNull();
  });

  test("browser proof, expiry, and callback replay cannot authorize or redirect off site", async () => {
    const a = await owner();
    const pending = await a.client.mutation(
      api.tables.oauthStates.mutations.start,
      { app: "slack", returnTo: "https://attacker.example/steal" },
    );
    const callback = await backend.fetch(
      `/api/slack/callback?state=${pending.state}&code=connect`,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain(
      `${board}/oauth/complete`,
    );
    expect(
      await backend.run((ctx) => ctx.db.query("connections").collect()),
    ).toEqual([]);
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
    ).toBe(404);
    expect(
      await a.client.action(api.tables.oauthStates.finish.complete, {
        ...pending,
        app: "slack",
        code: "connect",
      }),
    ).toMatchObject({ connected: true, returnTo: `${board}/connections` });
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

  test("disconnect commits locally even when upstream revocation fails, and targets only its subject/installation", async () => {
    const user = await owner(),
      account = await connect(user.client);
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
    expect(
      await backend.run((ctx) => ctx.db.get("connections", account.id)),
    ).toBeNull();
  });
});

describe("managed account isolation", () => {
  test("two Scope owners authorizing the same Slack user receive distinct subjects", async () => {
    const a = await owner(),
      b = await owner();
    const accountA = await connect(a.client),
      accountB = await connect(b.client);
    const rowA = await storedConnection(a.id, accountA.id);
    const rowB = await storedConnection(b.id, accountB.id);
    expect(rowA!.connect.subjectId).not.toBe(rowB!.connect.subjectId);
    await a.client.action(api.tables.connections.actions.disconnect, {
      app: "slack",
      connectionId: accountA.id,
    });
    expect(sdk.revokeToken).toHaveBeenCalledWith(connector.id, {
      subject: { type: "user", id: rowA!.connect.subjectId, issuer: site },
      installationId: "inst_T1",
    });
    expect(
      await backend.run((ctx) => ctx.db.get("connections", accountB.id)),
    ).not.toBeNull();
  });
  test("reconnecting keeps one account and replaces its provider reference", async () => {
    const user = await owner(),
      account = await connect(user.client);
    const old = await storedConnection(user.id, account.id);
    const reconnected = await connect(user.client);
    expect(reconnected.id).toBe(account.id);
    expect(
      await backend.run((ctx) => ctx.db.query("connections").collect()),
    ).toHaveLength(1);
    expect(sdk.revokeToken).not.toHaveBeenCalled();
    const current = await storedConnection(user.id, account.id);
    expect(current!.grantVersion).toBeGreaterThan(old!.grantVersion);
    expect(current!.connect.subjectId).not.toBe(old!.connect.subjectId);
  });
});

test("Slack authorization is unavailable when its managed bridge is unconfigured", async () => {
  vi.stubEnv("CONNECT_BRIDGE_URL", "");
  const user = await owner();
  const pending = await user.client.mutation(
    api.tables.oauthStates.mutations.start,
    {
      app: "slack",
      returnTo: `${board}/connections`,
    },
  );
  const response = await backend.fetch(
    `/api/slack/connect?state=${pending.state}`,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("Slack Connect is unavailable");
  expect(sdk.startAuthorization).not.toHaveBeenCalled();
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

async function storedConnection(userId: string, id: string) {
  return backend.run(async (ctx) => {
    const normalized = ctx.db.normalizeId("connections", id);
    const row = normalized ? await ctx.db.get("connections", normalized) : null;
    return row?.userId === userId ? row : null;
  });
}
