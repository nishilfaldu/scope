/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import {
  effectiveGoogleApps,
  googleScopesAreBounded,
} from "../convex/domain/apps";
import { github } from "../convex/oauth/providers/github";
import { slack } from "../convex/oauth/providers/slack";
import { linear } from "../convex/oauth/providers/linear";
import { notion } from "../convex/oauth/providers/notion";
import { sha256Hex } from "../convex/lib/secrets";
import { githubGrantIsExclusive } from "../convex/tables/slices/helpers";

const modules = import.meta.glob("../convex/**/*.ts");
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function owner(t: ReturnType<typeof convexTest>, email: string) {
  const id = await t.run((ctx) => ctx.db.insert("users", { email }));
  return { id, session: t.withIdentity({ subject: `${id}|session` }) };
}

test("OAuth completion requires the initiating browser and Scope session before consuming state", async () => {
  vi.stubEnv("BOARD_ORIGIN", "https://board.example");
  vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
  vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.test");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "secret");
  const t = convexTest(schema, modules);
  const first = await owner(t, "first@example.com");
  const second = await owner(t, "second@example.com");
  const started = await first.session.mutation(
    api.tables.oauthStates.mutations.start,
    {
      app: "github",
      returnTo: "https://board.example/connections",
    },
  );
  const callback = await t.fetch(
    `/api/github/callback?state=${started.state}&code=code-1`,
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toContain("/oauth/complete");
  expect(
    await t.run((ctx) => ctx.db.query("connections").take(2)),
  ).toHaveLength(0);
  const finish = (session: typeof first.session, browserProof: string) =>
    session.action(api.tables.oauthStates.finish.complete, {
      app: "github",
      state: started.state,
      code: "code-1",
      browserProof,
    });
  await expect(finish(second.session, started.browserProof)).rejects.toThrow(
    "mismatch",
  );
  await expect(finish(first.session, "wrong")).rejects.toThrow("mismatch");
  await expect(finish(first.session, "")).rejects.toThrow("mismatch");
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      json({
        access_token: "provider-token",
        refresh_token: "provider-refresh",
      }),
    )
    .mockResolvedValueOnce(json({ login: "octocat", id: 1 }));
  expect(await finish(first.session, started.browserProof)).toMatchObject({
    connected: true,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await expect(finish(first.session, started.browserProof)).rejects.toThrow(
    "mismatch",
  );
  expect(
    await t.run((ctx) => ctx.db.query("connections").take(2)),
  ).toHaveLength(1);
});

test("Notion workspace authorization is distinct while reconnecting the same authorization preserves its row", async () => {
  vi.stubEnv("NOTION_CLIENT_ID", "client");
  vi.stubEnv("NOTION_CLIENT_SECRET", "secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
  const t = convexTest(schema, modules);
  const { id } = await owner(t, "owner@example.com");
  const exchange = async (workspaceId: string, token: string) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({
        access_token: token,
        refresh_token: `refresh-${token}`,
        workspace_id: workspaceId,
        workspace_name: workspaceId,
        bot_id: `bot-${workspaceId}`,
        owner: { user: { id: "same-person", name: "Owner" } },
      }),
    );
    const grant = await notion.exchange("code");
    if ("error" in grant) throw new Error(grant.error);
    await t.mutation(internal.tables.connections.mutations.saveConnection, {
      userId: id,
      provider: "notion",
      app: "notion",
      ...grant,
    });
    vi.restoreAllMocks();
  };
  await exchange("workspace-A", "token-A");
  const first = (await t.run((ctx) => ctx.db.query("connections").take(2)))[0];
  const bindingId = await t.run(async (ctx) => {
    const sliceId = await ctx.db.insert("slices", {
      userId: id,
      agentId: "agent",
      name: "Notion A",
      token: "notion-a",
      secretHash: "unused",
      status: "active",
      expiresAt: Date.now() + 60_000,
      mintPolicy: "auto",
    });
    return await ctx.db.insert("sliceBindings", {
      sliceId,
      app: "notion",
      connectionId: first._id,
    });
  });
  await exchange("workspace-B", "token-B");
  expect(
    (await t.run((ctx) => ctx.db.get("sliceBindings", bindingId)))
      ?.connectionId,
  ).toBe(first._id);
  const beforeReconnect = await t.query(
    internal.tables.connections.queries.getConnection,
    {
      userId: id,
      app: "notion",
      connectionId: first._id,
    },
  );
  expect(beforeReconnect?.accessToken).toBe("token-A");
  expect(
    await t.run((ctx) => ctx.db.query("connections").take(3)),
  ).toHaveLength(2);
  await exchange("workspace-A", "token-A2");
  const rows = await t.run((ctx) => ctx.db.query("connections").take(3));
  expect(rows).toHaveLength(2);
  expect(
    rows.find((row) => row.providerUserId === "workspace-A:bot-workspace-A")
      ?._id,
  ).toBe(first._id);
  expect(
    rows.find((row) => row.providerUserId === "workspace-B:bot-workspace-B")
      ?.login,
  ).toContain("workspace-B");
});

test("Google files requires the combined bounded resource scopes", () => {
  expect(effectiveGoogleApps("files")).toEqual(["files"]);
  expect(
    googleScopesAreBounded("files", [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
    ]),
  ).toBe(true);
  expect(
    googleScopesAreBounded("files", [
      "email",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
    ]),
  ).toBe(true);
  expect(
    googleScopesAreBounded("files", [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
    ]),
  ).toBe(false);
  expect(
    googleScopesAreBounded("files", [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
    ]),
  ).toBe(false);
  expect(
    googleScopesAreBounded("files", [
      "email",
      "https://www.googleapis.com/auth/drive",
    ]),
  ).toBe(false);
  expect(googleScopesAreBounded("files", undefined)).toBe(false);
});

test("refresh lease fences reconnection and serializes concurrent refreshes with expiry recovery", async () => {
  const t = convexTest(schema, modules);
  const { id } = await owner(t, "owner@example.com");
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    provider: "linear",
    app: "linear",
    accessToken: "A",
    refreshToken: "RA",
    login: "user",
    providerUserId: "1",
  });
  const connectionId = (await t.run((ctx) =>
    ctx.db.query("connections").unique(),
  ))!._id;
  const begin = (lease: string, version: number) =>
    t.mutation(internal.tables.connections.mutations.beginRefresh, {
      userId: id,
      app: "linear",
      connectionId,
      grantVersion: version,
      lease,
    });
  expect(await begin("lease-A", 1)).toBe(true);
  expect(await begin("lease-other", 1)).toBe(false);
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    provider: "linear",
    app: "linear",
    accessToken: "B",
    refreshToken: "RB",
    login: "user",
    providerUserId: "1",
  });
  expect(
    await t.mutation(internal.tables.connections.mutations.refreshConnection, {
      userId: id,
      app: "linear",
      connectionId,
      providerUserId: "1",
      accessToken: "stale-A",
      refreshToken: "stale-RA",
      grantVersion: 1,
      lease: "lease-A",
    }),
  ).toBe(false);
  expect(await begin("lease-B", 2)).toBe(true);
  await t.mutation(internal.tables.connections.mutations.releaseRefresh, {
    connectionId,
    lease: "lease-B",
  });
  expect(await begin("lease-C", 2)).toBe(true);
  const stored = await t.query(
    internal.tables.connections.queries.getConnection,
    { userId: id, app: "linear", connectionId },
  );
  expect(stored).toMatchObject({
    accessToken: "B",
    refreshToken: "RB",
    grantVersion: 2,
  });
});

test("normal Slack and Linear consent omits administrative scopes", async () => {
  vi.stubEnv("SLACK_CLIENT_ID", "slack-client");
  vi.stubEnv("LINEAR_CLIENT_ID", "linear-client");
  vi.stubEnv("LINEAR_CLIENT_SECRET", "linear-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
  const slackStart = await slack.authorize("state");
  const linearStart = await linear.authorize("state");
  if (!("url" in slackStart) || !("url" in linearStart))
    throw new Error("OAuth not configured");
  const scopes = new URL(slackStart.url).searchParams
    .get("user_scope")!
    .split(",");
  expect(scopes).not.toContain("admin");
  expect(scopes).not.toContain("admin.users:read");
  expect(new URL(linearStart.url).searchParams.get("scope")).toBe("read,write");
});

test("GitHub exchange failure never retries with code or client secret in URL", async () => {
  vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.test");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "sensitive-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(json({ error: "bad_verification_code" }));
  expect(await github.exchange("sensitive-code")).toEqual({
    error: "bad_verification_code",
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  for (const [url] of fetchMock.mock.calls) {
    expect(String(url)).not.toContain("sensitive-secret");
    expect(String(url)).not.toContain("sensitive-code");
  }
});

test("a GitHub grant cannot be bound to two active agent lineages", async () => {
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    provider: "github",
    app: "github",
    accessToken: "standing",
    refreshToken: "refresh",
    login: "octocat",
    providerUserId: "1",
  });
  const connection = (await t.run((ctx) =>
    ctx.db.query("connections").unique(),
  ))!;
  await t.run(async (ctx) => {
    await ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "agent-A",
      name: "A",
      secretHash: "unused",
      status: "active",
    });
    const sliceId = await ctx.db.insert("slices", {
      userId: id,
      agentId: "agent-A",
      name: "A",
      token: "slice-A",
      secretHash: "unused",
      status: "active",
      expiresAt: Date.now() + 60_000,
      mintPolicy: "auto",
    });
    await ctx.db.insert("sliceBindings", {
      sliceId,
      app: "github",
      connectionId: connection._id,
    });
  });
  await expect(
    session.mutation(internal.tables.slices.mutations.createFixture, {
      name: "B",
      ttlMs: 60_000,
      apps: ["github"],
      mintPolicy: "auto",
    }),
  ).rejects.toThrow("cannot be shared");
});

test("revoking a GitHub holder releases its grant for pending approval", async () => {
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    provider: "github",
    app: "github",
    accessToken: "standing",
    refreshToken: "refresh",
    login: "octocat",
    providerUserId: "1",
  });
  const connection = (await t.run((ctx) =>
    ctx.db.query("connections").unique(),
  ))!;
  const { holder, sliceId } = await t.run(async (ctx) => {
    const holder = await ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "agent-A",
      name: "A",
      secretHash: "unused",
      status: "active",
    });
    await ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "agent-B",
      name: "B",
      secretHash: "unused",
      status: "active",
    });
    const sliceId = await ctx.db.insert("slices", {
      userId: id,
      agentId: "agent-A",
      name: "A",
      token: "slice-A",
      secretHash: "unused",
      status: "active",
      expiresAt: Date.now() + 60_000,
      mintPolicy: "auto",
    });
    await ctx.db.insert("sliceBindings", {
      sliceId,
      app: "github",
      connectionId: connection._id,
    });
    await ctx.db.insert("sliceRequests", {
      userId: id,
      agentId: "agent-B",
      publicToken: "pending-B",
      claimSecretHash: "unused",
      status: "pending",
      approvalDeadlineAt: Date.now() + 60_000,
      apps: ["github"],
      ttlMs: 60_000,
      reason: "GitHub access",
    });
    return { holder, sliceId };
  });
  const decide = () =>
    session.mutation(api.tables.slices.sliceRequests.decide, {
      publicToken: "pending-B",
      decision: "approved",
      bindings: [{ app: "github", connectionId: connection._id }],
    });
  await expect(decide()).rejects.toThrow("cannot be shared");
  await session.mutation(api.tables.agentConnections.revoke, {
    agentConnectionId: holder,
  });
  expect((await t.run((ctx) => ctx.db.get("slices", sliceId)))?.status).toBe(
    "active",
  );
  await expect(decide()).resolves.toBeNull();
  expect(
    (
      await t.run((ctx) =>
        ctx.db
          .query("sliceRequests")
          .withIndex("by_public_token", (q) => q.eq("publicToken", "pending-B"))
          .unique(),
      )
    )?.status,
  ).toBe("approved");
});

test("pending request quota is indexed by owner and expired requests do not consume it", async () => {
  const t = convexTest(schema, modules);
  const first = await owner(t, "first@example.com");
  const second = await owner(t, "second@example.com");
  const agentSecret = "agent-secret";
  const agentConnectionId = await t.run(async (ctx) => {
    for (let i = 0; i < 100; i++) {
      await ctx.db.insert("sliceRequests", {
        userId: first.id,
        agentId: "first-agent",
        publicToken: `first-${i}`,
        claimSecretHash: `hash-${i}`,
        status: "pending",
        approvalDeadlineAt: Date.now() + 60_000,
        apps: ["github"],
        ttlMs: 60_000,
        reason: "first",
      });
    }
    await ctx.db.insert("sliceRequests", {
      userId: second.id,
      agentId: "second-agent",
      publicToken: "expired",
      claimSecretHash: "expired-hash",
      status: "pending",
      approvalDeadlineAt: Date.now() - 1,
      apps: ["github"],
      ttlMs: 60_000,
      reason: "expired",
    });
    return await ctx.db.insert("agentConnections", {
      userId: second.id,
      agentId: "second-agent",
      name: "Second",
      secretHash: await sha256Hex(agentSecret),
      status: "active",
    });
  });
  const result = await t.mutation(
    internal.tables.slices.sliceRequestClaims.createSliceRequest,
    {
      agentConnectionId,
      agentConnectionSecret: agentSecret,
      apps: ["github"],
      ttlMs: 60_000,
      reason: "second owner's first request",
    },
  );
  expect(result).toMatchObject({ ok: true });
});

test("initial approve mint policy and changed pre-claim policy are both reported and enforced", async () => {
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  const agentSecret = "agent-secret";
  const agentConnectionId = await t.run(async (ctx) =>
    ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "agent",
      name: "Agent",
      status: "active",
      secretHash: await sha256Hex(agentSecret),
    }),
  );
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    provider: "linear",
    app: "linear",
    accessToken: "standing",
    refreshToken: "refresh",
    login: "linear",
    providerUserId: "1",
  });
  const connectionId = (await t.run((ctx) =>
    ctx.db.query("connections").unique(),
  ))!._id;
  const request = await t.mutation(
    internal.tables.slices.sliceRequestClaims.createSliceRequest,
    {
      agentConnectionId,
      agentConnectionSecret: agentSecret,
      apps: ["linear"],
      ttlMs: 60_000,
      reason: "test policy",
    },
  );
  if (!request.ok) throw new Error(request.reason);
  await session.mutation(api.tables.slices.sliceRequests.decide, {
    publicToken: request.publicToken,
    decision: "approved",
    mintPolicy: "approve",
    bindings: [{ app: "linear", connectionId }],
  });
  const claim = await t.mutation(
    internal.tables.slices.sliceRequestClaims.resolveSliceRequestClaim,
    { claimHandle: request.claimHandle },
  );
  expect(claim).toMatchObject({
    ok: true,
    kind: "slice",
    mintPolicy: "approve",
  });
  if (!claim.ok || claim.kind !== "slice") throw new Error("claim failed");
  expect(
    await t.mutation(
      internal.tables.slices.sliceRequestClaims.acknowledgeSliceClaim,
      { claimHandle: request.claimHandle, sliceSecret: claim.sliceSecret },
    ),
  ).toMatchObject({ ok: true, resourceStatus: "active" });
  const mint = await t.fetch("/api/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sliceToken: claim.sliceToken,
      sliceSecret: claim.sliceSecret,
      app: "linear",
    }),
  });
  expect(mint.status).toBe(202);
  await session.mutation(api.tables.slices.mutations.setMintPolicy, {
    sliceToken: claim.sliceToken,
    mintPolicy: "auto",
  });
  const currentSlice = await t.run((ctx) =>
    ctx.db.get("slices", claim.sliceId),
  );
  expect(currentSlice?.mintPolicy).toBe("auto");
  expect(
    await t.mutation(
      internal.tables.slices.sliceRequestClaims.acknowledgeSliceClaim,
      {
        claimHandle: request.claimHandle,
        sliceSecret: "wrong",
      },
    ),
  ).toMatchObject({ ok: false, status: 401, code: "UNAUTHORIZED" });
  expect(
    await t.mutation(
      internal.tables.slices.sliceRequestClaims.acknowledgeSliceClaim,
      {
        claimHandle: request.claimHandle,
        sliceSecret: claim.sliceSecret,
      },
    ),
  ).toMatchObject({ ok: true, resourceStatus: "active" });
  expect(
    await t.mutation(
      internal.tables.slices.sliceRequestClaims.resolveSliceRequestClaim,
      {
        claimHandle: request.claimHandle,
      },
    ),
  ).toMatchObject({
    ok: false,
    status: 409,
    code: "CLAIM_ALREADY_ACKNOWLEDGED",
  });
});

test("a held provider refresh cannot deliver stale authority after OAuth reconnection", async () => {
  vi.stubEnv("LINEAR_CLIENT_ID", "client");
  vi.stubEnv("LINEAR_CLIENT_SECRET", "secret");
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    provider: "linear",
    app: "linear",
    accessToken: "A",
    refreshToken: "RA",
    login: "user",
    providerUserId: "1",
  });
  const created = await session.mutation(
    internal.tables.slices.mutations.createFixture,
    {
      name: "Agent",
      ttlMs: 60_000,
      apps: ["linear"],
      mintPolicy: "auto",
    },
  );
  let release!: (value: Response) => void;
  const pendingProvider = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const providerEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    entered();
    return pendingProvider;
  });
  const mint = t.fetch("/api/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sliceToken: created.sliceToken,
      sliceSecret: created.sliceSecret,
      app: "linear",
    }),
  });
  await providerEntered;
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    provider: "linear",
    app: "linear",
    accessToken: "B",
    refreshToken: "RB",
    login: "user",
    providerUserId: "1",
  });
  release(
    json({
      access_token: "stale-A",
      refresh_token: "stale-RA",
      expires_in: 3600,
    }),
  );
  const result = await mint;
  expect(result.status).toBe(403);
  expect(JSON.stringify(await result.json())).not.toContain("stale-A");
  const row = (await t.run((ctx) => ctx.db.query("connections").unique()))!;
  const stored = await t.query(
    internal.tables.connections.queries.getConnection,
    {
      userId: id,
      app: "linear",
      connectionId: row._id,
    },
  );
  expect(stored).toMatchObject({ accessToken: "B", refreshToken: "RB" });
});

test("an interrupted refresh lease can be recovered after its deadline", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const { id } = await owner(t, "owner@example.com");
    await t.mutation(internal.tables.connections.mutations.saveConnection, {
      userId: id,
      provider: "linear",
      app: "linear",
      accessToken: "A",
      refreshToken: "RA",
      login: "user",
      providerUserId: "1",
    });
    const connectionId = (await t.run((ctx) =>
      ctx.db.query("connections").unique(),
    ))!._id;
    const begin = (lease: string) =>
      t.mutation(internal.tables.connections.mutations.beginRefresh, {
        userId: id,
        app: "linear",
        connectionId,
        grantVersion: 1,
        lease,
      });
    expect(await begin("interrupted")).toBe(true);
    expect(await begin("next")).toBe(false);
    vi.advanceTimersByTime(120_001);
    expect(await begin("recovered")).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test.each([
  [undefined, 200],
  [
    "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive",
    403,
  ],
  ["https://www.googleapis.com/auth/userinfo.email", 403],
] as const)(
  "Google refresh scope %s yields status %s",
  async (scope, expectedStatus) => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    const t = convexTest(schema, modules);
    const { id, session } = await owner(t, "owner@example.com");
    await t.mutation(internal.tables.connections.mutations.saveConnection, {
      userId: id,
      provider: "google",
      app: "gmail",
      accessToken: "standing",
      refreshToken: "refresh",
      login: "gmail",
      providerUserId: "sub",
      grantedScopes: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/gmail.modify",
      ],
    });
    const created = await session.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Gmail",
        ttlMs: 60_000,
        apps: ["gmail"],
        mintPolicy: "auto",
      },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        access_token: "fresh-token",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
        ...(scope ? { scope } : {}),
      }),
    );
    const response = await t.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "gmail",
      }),
    });
    expect(response.status).toBe(expectedStatus);
    const body = await response.json();
    if (expectedStatus === 200) expect(body.accessToken).toBe("fresh-token");
    else expect(JSON.stringify(body)).not.toContain("fresh-token");
  },
);

test("active lineages remain paginated and selectable past 100 historical and 100 live rows", async () => {
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  const oldestId = await t.run((ctx) =>
    ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "oldest",
      name: "Oldest",
      secretHash: "hash",
      status: "active",
    }),
  );
  await t.run(async (ctx) => {
    for (let i = 0; i < 110; i++) {
      await ctx.db.insert("agentConnections", {
        userId: id,
        agentId: `history-${i}`,
        name: `History ${i}`,
        secretHash: "hash",
        status: "revoked",
      });
    }
    for (let i = 0; i < 110; i++) {
      await ctx.db.insert("agentConnections", {
        userId: id,
        agentId: `live-${i}`,
        name: `Live ${i}`,
        secretHash: "hash",
        status: "active",
      });
    }
  });
  const first = await session.query(api.tables.agentDashboard.activePage, {
    paginationOpts: { numItems: 50, cursor: null },
  });
  expect(first.page).toHaveLength(50);
  expect(first.isDone).toBe(false);
  const second = await session.query(api.tables.agentDashboard.activePage, {
    paginationOpts: { numItems: 50, cursor: first.continueCursor },
  });
  const third = await session.query(api.tables.agentDashboard.activePage, {
    paginationOpts: { numItems: 50, cursor: second.continueCursor },
  });
  expect(
    [...first.page, ...second.page, ...third.page].some(
      (row) => row._id === oldestId,
    ),
  ).toBe(true);
  const options = await session.query(
    api.tables.agentConnections.replacementOptionsPage,
    { paginationOpts: { numItems: 150, cursor: null } },
  );
  expect(options.page.some((row) => row.id === oldestId)).toBe(true);
});

test("GitHub exclusivity checks live owners beyond 100 historical bindings", async () => {
  const t = convexTest(schema, modules);
  const { id } = await owner(t, "owner@example.com");
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    app: "github",
    provider: "github",
    accessToken: "standing",
    login: "owner",
    providerUserId: "github-owner",
  });
  const connection = (await t.run((ctx) =>
    ctx.db.query("connections").unique(),
  ))!;
  await t.run(async (ctx) => {
    for (let i = 0; i < 120; i++) {
      const sliceId = await ctx.db.insert("slices", {
        userId: id,
        agentId: `retired-${i}`,
        name: `Retired ${i}`,
        token: `token-${i}`,
        secretHash: "hash",
        status: "revoked",
        expiresAt: Date.now() + 60_000,
        mintPolicy: "auto",
      });
      await ctx.db.insert("sliceBindings", {
        sliceId,
        app: "github",
        connectionId: connection._id,
      });
    }
  });
  expect(
    await t.run((ctx) =>
      githubGrantIsExclusive(ctx, connection._id, "new-agent"),
    ),
  ).toBe(true);
  await t.run(async (ctx) => {
    const agentId = "other-live-agent";
    await ctx.db.insert("agentConnections", {
      userId: id,
      agentId,
      name: "Other",
      secretHash: "hash",
      status: "active",
    });
    const sliceId = await ctx.db.insert("slices", {
      userId: id,
      agentId,
      name: "Other's grant",
      token: "other-token",
      secretHash: "hash",
      status: "active",
      expiresAt: Date.now() + 60_000,
      mintPolicy: "auto",
    });
    await ctx.db.insert("sliceBindings", {
      sliceId,
      app: "github",
      connectionId: connection._id,
    });
  });
  expect(
    await t.run((ctx) =>
      githubGrantIsExclusive(ctx, connection._id, "new-agent"),
    ),
  ).toBe(false);
});

test("a staged GitHub grant reserves the account until its handoff ends", async () => {
  const t = convexTest(schema, modules);
  const { id } = await owner(t, "owner@example.com");
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    app: "github",
    provider: "github",
    accessToken: "standing",
    login: "owner",
    providerUserId: "github-owner",
  });
  const connectionId = await t.run(async (ctx) => {
    const connectionId = (await ctx.db.query("connections").unique())!._id;
    await ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "first",
      name: "First",
      secretHash: "hash",
      status: "active",
    });
    const sliceId = await ctx.db.insert("slices", {
      userId: id,
      agentId: "first",
      name: "Reserved",
      token: "staged-token",
      secretHash: "hash",
      status: "staged",
      expiresAt: Date.now() + 600_000,
      mintPolicy: "auto",
    });
    await ctx.db.insert("sliceBindings", {
      sliceId,
      app: "github",
      connectionId,
    });
    await ctx.db.insert("sliceRequests", {
      agentId: "first",
      userId: id,
      apps: ["github"],
      ttlMs: 600_000,
      reason: "Read issues",
      publicToken: "ar_reservation",
      claimSecretHash: "claim-hash",
      status: "approved",
      approvalDeadlineAt: Date.now() + 600_000,
      pickupDeadlineAt: Date.now() + 300_000,
      createdSliceId: sliceId,
    });
    return connectionId;
  });
  expect(
    await t.run((ctx) => githubGrantIsExclusive(ctx, connectionId, "second")),
  ).toBe(false);
  await t.run(async (ctx) => {
    const request = await ctx.db
      .query("sliceRequests")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", "ar_reservation"),
      )
      .unique();
    await ctx.db.patch("sliceRequests", request!._id, {
      terminalReason: "pickup_timeout",
    });
  });
  expect(
    await t.run((ctx) => githubGrantIsExclusive(ctx, connectionId, "second")),
  ).toBe(true);
});

test("editing a slice cannot add a GitHub connection held by another live agent", async () => {
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    app: "github",
    provider: "github",
    accessToken: "standing",
    login: "owner",
    providerUserId: "github-owner",
  });
  const connection = (await t.run((ctx) =>
    ctx.db.query("connections").unique(),
  ))!;
  await t.run(async (ctx) => {
    for (const agentId of ["agent-A", "agent-B"]) {
      await ctx.db.insert("agentConnections", {
        userId: id,
        agentId,
        name: agentId,
        secretHash: "hash",
        status: "active",
      });
      const sliceId = await ctx.db.insert("slices", {
        userId: id,
        agentId,
        name: agentId,
        token: agentId,
        secretHash: "hash",
        status: "active",
        expiresAt: Date.now() + 60_000,
        mintPolicy: "auto",
      });
      if (agentId === "agent-A") {
        await ctx.db.insert("sliceBindings", {
          sliceId,
          app: "github",
          connectionId: connection._id,
        });
      }
    }
  });
  await expect(
    session.mutation(api.tables.slices.mutations.setBinding, {
      sliceToken: "agent-B",
      app: "github",
      enabled: true,
      connectionId: connection._id,
    }),
  ).rejects.toThrow("cannot be shared");
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("sliceBindings")
        .withIndex("by_connectionId", (q) =>
          q.eq("connectionId", connection._id),
        )
        .collect(),
    ),
  ).toHaveLength(1);
});

test("agent grants page reaches recent and older grants beyond 100", async () => {
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  const agentConnectionId = await t.run((ctx) =>
    ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "paged-agent",
      name: "Paged agent",
      secretHash: "hash",
      status: "active",
    }),
  );
  await t.run(async (ctx) => {
    for (let i = 0; i < 120; i++) {
      await ctx.db.insert("slices", {
        userId: id,
        agentId: "paged-agent",
        name: `Grant ${i}`,
        token: `page-token-${i}`,
        secretHash: "hash",
        status: "active",
        expiresAt: Date.now() + 60_000,
        mintPolicy: "auto",
      });
    }
  });
  const first = await session.query(api.tables.agentDashboard.grantsPage, {
    agentConnectionId,
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(first.page[0]?.name).toBe("Grant 119");
  const second = await session.query(api.tables.agentDashboard.grantsPage, {
    agentConnectionId,
    paginationOpts: { numItems: 110, cursor: first.continueCursor },
  });
  expect([...first.page, ...second.page]).toHaveLength(120);
  expect(second.page.at(-1)?.name).toBe("Grant 0");
});

test("new-agent claim recovers a lost response, then acknowledgment closes recovery", async () => {
  const t = convexTest(schema, modules);
  const { session } = await owner(t, "owner@example.com");
  const invite = await t.mutation(
    internal.tables.agentConnections.createInvite,
    { agentName: "Agent" },
  );
  await session.mutation(api.tables.agentConnections.decideInvite, {
    publicToken: invite.publicToken,
    decision: "approved",
  });
  const first = await t.mutation(internal.tables.agentConnections.claim, {
    claimHandle: invite.claimHandle,
  });
  const retry = await t.mutation(internal.tables.agentConnections.claim, {
    claimHandle: invite.claimHandle,
  });
  expect(retry).toEqual(first);
  if (first.kind !== "connected") throw new Error("missing connection");
  expect(
    await t.mutation(internal.tables.agentConnections.acknowledgeClaim, {
      claimHandle: invite.claimHandle,
      agentConnectionSecret: "wrong",
    }),
  ).toMatchObject({ ok: false, status: 401, code: "UNAUTHORIZED" });
  expect(
    await t.mutation(internal.tables.agentConnections.acknowledgeClaim, {
      claimHandle: invite.claimHandle,
      agentConnectionSecret: first.agentConnectionSecret,
    }),
  ).toMatchObject({ ok: true, resourceStatus: "active" });
  expect(
    await t.mutation(internal.tables.agentConnections.claim, {
      claimHandle: invite.claimHandle,
    }),
  ).toMatchObject({
    kind: "error",
    status: 409,
    code: "CLAIM_ALREADY_ACKNOWLEDGED",
  });
  const row = await t.run((ctx) =>
    ctx.db.get("agentConnections", first.agentConnectionId),
  );
  expect(row?.status).toBe("active");
});

test("unacknowledged new-agent claim is retired at its deadline", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const { session } = await owner(t, "owner@example.com");
    const invite = await t.mutation(
      internal.tables.agentConnections.createInvite,
      { agentName: "Agent" },
    );
    await session.mutation(api.tables.agentConnections.decideInvite, {
      publicToken: invite.publicToken,
      decision: "approved",
    });
    const first = await t.mutation(internal.tables.agentConnections.claim, {
      claimHandle: invite.claimHandle,
    });
    if (first.kind !== "connected") throw new Error("missing connection");
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    await t.mutation(internal.tables.agentConnectionExpiry.expireInvite, {
      publicToken: invite.publicToken,
    });
    expect(
      (
        await t.run((ctx) =>
          ctx.db.get("agentConnections", first.agentConnectionId),
        )
      )?.status,
    ).toBe("revoked");
  } finally {
    vi.useRealTimers();
  }
});

test("activated replacement remains authorized after its invite expires", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const { session } = await owner(t, "owner@example.com");
    const firstInvite = await t.mutation(
      internal.tables.agentConnections.createInvite,
      { agentName: "Agent" },
    );
    await session.mutation(api.tables.agentConnections.decideInvite, {
      publicToken: firstInvite.publicToken,
      decision: "approved",
    });
    const first = await t.mutation(internal.tables.agentConnections.claim, {
      claimHandle: firstInvite.claimHandle,
    });
    if (first.kind !== "connected") throw new Error("missing connection");
    expect(
      await t.mutation(internal.tables.agentConnections.acknowledgeClaim, {
        claimHandle: firstInvite.claimHandle,
        agentConnectionSecret: first.agentConnectionSecret,
      }),
    ).toMatchObject({ ok: true, resourceStatus: "active" });
    const rotation = await t.mutation(
      internal.tables.agentConnections.createInvite,
      {
        agentName: "Agent",
        previousConnectionId: first.agentConnectionId,
        previousConnectionSecret: first.agentConnectionSecret,
      },
    );
    await session.mutation(api.tables.agentConnections.decideInvite, {
      publicToken: rotation.publicToken,
      decision: "approved",
    });
    const replacement = await t.mutation(
      internal.tables.agentConnections.claim,
      { claimHandle: rotation.claimHandle },
    );
    if (replacement.kind !== "connected")
      throw new Error("missing replacement");
    expect(
      await t.mutation(internal.tables.agentConnections.activateReplacement, {
        agentConnectionId: replacement.agentConnectionId,
        agentConnectionSecret: replacement.agentConnectionSecret,
      }),
    ).toMatchObject({ ok: true, status: "active" });
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    await t.mutation(internal.tables.agentConnectionExpiry.expireInvite, {
      publicToken: rotation.publicToken,
    });
    expect(
      (
        await t.run((ctx) =>
          ctx.db.get("agentConnections", replacement.agentConnectionId),
        )
      )?.status,
    ).toBe("active");
    expect(
      await t.mutation(internal.tables.agentConnections.activateReplacement, {
        agentConnectionId: replacement.agentConnectionId,
        agentConnectionSecret: replacement.agentConnectionSecret,
      }),
    ).toMatchObject({ ok: true, status: "active" });
    await expect(
      t.mutation(internal.tables.agentConnections.createInvite, {
        agentName: "Agent",
        previousConnectionId: replacement.agentConnectionId,
        previousConnectionSecret: replacement.agentConnectionSecret,
      }),
    ).resolves.toMatchObject({ reconnecting: true });
  } finally {
    vi.useRealTimers();
  }
});

test("expired OAuth state deletes its stored PKCE verifier", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const { session } = await owner(t, "owner@example.com");
    const { state } = await session.mutation(
      api.tables.oauthStates.mutations.start,
      { app: "airtable", returnTo: "/connections" },
    );
    const storedState = () =>
      t.run((ctx) =>
        ctx.db
          .query("oauthStates")
          .withIndex("by_state", (q) => q.eq("state", state))
          .unique(),
      );
    expect((await storedState())?.pkceVerifier).toBeTruthy();
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await t.mutation(internal.tables.oauthStates.mutations.expire, { state });
    expect(await storedState()).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("Airtable PKCE verifier is independent of public state and wrong verifier is rejected", async () => {
  vi.stubEnv("BOARD_ORIGIN", "https://board.example");
  vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
  vi.stubEnv("AIRTABLE_CLIENT_ID", "client");
  vi.stubEnv("AIRTABLE_CLIENT_SECRET", "secret");
  const { codeChallenge } = await import("../convex/oauth/providers/airtable");
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  const started = await session.mutation(
    api.tables.oauthStates.mutations.start,
    {
      app: "airtable",
      returnTo: "https://board.example/connections",
    },
  );
  const pending = await t.query(internal.tables.oauthStates.queries.get, {
    state: started.state,
  });
  expect(pending?.pkceChallenge).toBeTruthy();
  expect(pending?.pkceChallenge).not.toBe(
    await codeChallenge(
      `${started.state.replaceAll("-", "")}.${started.state.replaceAll("-", "")}`,
    ),
  );
  const connect = await t.fetch(`/api/airtable/connect?state=${started.state}`);
  expect(
    new URL(connect.headers.get("location")!).searchParams.get(
      "code_challenge",
    ),
  ).toBe(pending?.pkceChallenge);
  const origin = await t.mutation(
    internal.tables.oauthStates.mutations.consume,
    {
      state: started.state,
      userId: id,
      browserProof: started.browserProof,
    },
  );
  expect(origin?.pkceVerifier).toBeTruthy();
  expect(await codeChallenge(origin!.pkceVerifier!)).toBe(
    pending?.pkceChallenge,
  );
  expect(
    await t.query(internal.tables.oauthStates.queries.get, {
      state: started.state,
    }),
  ).toBeNull();
  const { airtable } = await import("../convex/oauth/providers/airtable");
  const provider = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("code_verifier") !== origin!.pkceVerifier)
        return json({ error: "invalid_grant" });
      return json({ access_token: "access", refresh_token: "refresh" });
    });
  expect(
    await airtable.exchange(
      "code",
      started.state,
      "airtable",
      "wrong-verifier",
    ),
  ).toMatchObject({ error: "invalid_grant" });
  provider.mockRestore();
});

test.each(["approved", "claimed"] as const)(
  "an unacknowledged %s slice is retired when its claim window expires",
  async (status) => {
    const t = convexTest(schema, modules);
    const { id } = await owner(t, "owner@example.com");
    const ids = await t.run(async (ctx) => {
      const sliceId = await ctx.db.insert("slices", {
        userId: id,
        agentId: "agent",
        name: "Slice",
        token: "token",
        secretHash: await sha256Hex("secret"),
        status: "staged",
        expiresAt: Date.now() + 60_000,
        mintPolicy: "auto",
      });
      const requestId = await ctx.db.insert("sliceRequests", {
        userId: id,
        agentId: "agent",
        publicToken: "public",
        claimSecretHash: "hash",
        status,
        approvalDeadlineAt: Date.now() - 1,
        pickupDeadlineAt: status === "approved" ? Date.now() - 1 : undefined,
        ackDeadlineAt: status === "claimed" ? Date.now() - 1 : undefined,
        apps: ["linear"],
        ttlMs: 60_000,
        reason: "test",
        createdSliceId: sliceId,
        issuedSliceSecretCipher: "cipher",
      });
      return { sliceId, requestId };
    });
    await t.mutation(
      internal.tables.slices.sliceRequestExpiry.clearClaimSecret,
      {
        requestId: ids.requestId,
      },
    );
    expect(
      (await t.run((ctx) => ctx.db.get("slices", ids.sliceId)))?.status,
    ).toBe("revoked");
    expect(
      (await t.run((ctx) => ctx.db.get("sliceRequests", ids.requestId)))
        ?.issuedSliceSecretCipher,
    ).toBe("");
  },
);

test("GitHub user-token refresh invalidates the prior access token, so a second agent is refused", async () => {
  vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.testapp");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "secret");
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId: id,
    provider: "github",
    app: "github",
    accessToken: "standing",
    refreshToken: "refresh-0",
    login: "octocat",
    providerUserId: "1",
  });
  const created = await session.mutation(
    internal.tables.slices.mutations.createFixture,
    {
      name: "Agent A",
      ttlMs: 60_000,
      apps: ["github"],
      mintPolicy: "auto",
    },
  );
  const valid = new Set<string>();
  let generation = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    valid.clear();
    const token = `github-access-${++generation}`;
    valid.add(token);
    return json({
      access_token: token,
      refresh_token: `github-refresh-${generation}`,
      expires_in: 3600,
    });
  });
  const mint = () =>
    t.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      }),
    });
  const first = await mint();
  expect(first.status).toBe(200);
  const firstToken = (await first.json()).accessToken as string;
  expect(valid.has(firstToken)).toBe(true);
  const second = await mint();
  expect(second.status).toBe(200);
  expect(valid.has(firstToken)).toBe(false);
  const connection = (await t.run((ctx) =>
    ctx.db.query("connections").unique(),
  ))!;
  await t.run(async (ctx) => {
    await ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "agent-B",
      name: "B",
      secretHash: "unused",
      status: "active",
    });
    const otherSlice = await ctx.db.insert("slices", {
      userId: id,
      agentId: "agent-B",
      name: "B",
      token: "other",
      secretHash: await sha256Hex("other-secret"),
      status: "active",
      expiresAt: Date.now() + 60_000,
      mintPolicy: "auto",
    });
    // A second authorization to the same grant is forbidden transactionally.
    await ctx.db.insert("sliceBindings", {
      sliceId: otherSlice,
      app: "github",
      connectionId: connection._id,
    });
  });
  const blocked = await t.fetch("/api/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sliceToken: "other",
      sliceSecret: "other-secret",
      app: "github",
    }),
  });
  expect(blocked.status).toBe(403);
  await expect(
    session.mutation(internal.tables.slices.mutations.createFixture, {
      name: "Agent C",
      ttlMs: 60_000,
      apps: ["github"],
      mintPolicy: "auto",
    }),
  ).rejects.toThrow("cannot be shared");
});

test("concurrent requests for one owner cannot exceed the pending allowance", async () => {
  const t = convexTest(schema, modules);
  const { id } = await owner(t, "owner@example.com");
  const secret = "agent-secret";
  const agentConnectionId = await t.run(async (ctx) => {
    for (let i = 0; i < 99; i++) {
      await ctx.db.insert("sliceRequests", {
        userId: id,
        agentId: "agent",
        publicToken: `pending-${i}`,
        claimSecretHash: `hash-${i}`,
        status: "pending",
        approvalDeadlineAt: Date.now() + 60_000,
        apps: ["linear"],
        ttlMs: 60_000,
        reason: "existing",
      });
    }
    return await ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "agent",
      name: "Agent",
      status: "active",
      secretHash: await sha256Hex(secret),
    });
  });
  const create = (reason: string) =>
    t.mutation(internal.tables.slices.sliceRequestClaims.createSliceRequest, {
      agentConnectionId,
      agentConnectionSecret: secret,
      apps: ["linear"],
      ttlMs: 60_000,
      reason,
    });
  const results = await Promise.all([create("first"), create("second")]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toMatchObject([
    { code: "INVALID_REQUEST", status: 429 },
  ]);
});
