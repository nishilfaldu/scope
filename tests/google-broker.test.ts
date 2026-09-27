/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const scopes = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
];
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

async function setup() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { name: "Owner", email: "owner@example.com" }),
  );
  {
    const app = "files";
    await t.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      provider: "google",
      app,
      accessToken: `standing-${app}`,
      refreshToken: `refresh-${app}`,
      login: "owner@example.com",
      providerUserId: "google-user",
      grantedScopes: scopes,
    });
  }
  const fixture = await t
    .withIdentity({ subject: `${userId}|session-1` })
    .mutation(internal.tables.slices.mutations.createFixture, {
      name: "Google",
      ttlMs: 60_000,
      apps: ["files"],
      mintPolicy: "auto",
    });
  const mint = async (options: { omitRefreshScope?: boolean } = {}) => {
    const app = "files";
    const refresh = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        access_token: `minted-${app}-${crypto.randomUUID()}`,
        expires_in: 3600,
        ...(options.omitRefreshScope ? {} : { scope: scopes.join(" ") }),
      }),
    );
    let response: Response;
    try {
      response = await t.fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sliceToken: fixture.sliceToken,
          sliceSecret: fixture.sliceSecret,
          app,
        }),
      });
    } finally {
      refresh.mockRestore();
    }
    expect(response.status).toBe(200);
    return (await response.json()) as { brokerToken: string; app: string };
  };
  const operate = async (
    brokerToken: string,
    operation: string,
    extra: Record<string, unknown> = {},
  ) =>
    t.fetch("/api/google/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brokerToken, operation, ...extra }),
    });
  return { t, userId, fixture, mint, operate };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("one files credential can call Drive, Docs, and Sheets operations", async () => {
  const { mint, operate } = await setup();
  const credential = await mint();
  expect(credential).toMatchObject({
    app: "files",
    brokerToken: expect.stringMatching(/^gc_/),
  });
  expect(credential).not.toHaveProperty("accessToken");
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) => {
      if (String(url) === "https://oauth2.googleapis.com/token")
        return json({
          access_token: "fresh-files",
          expires_in: 3600,
          scope: scopes.join(" "),
        });
      return json(
        String(url).includes("drive/v3/files")
          ? { files: [] }
          : { id: "resource123" },
      );
    });
  for (const [operation, extra] of [
    ["drive.list", {}],
    ["docs.get", { id: "document123" }],
    ["sheets.get", { id: "sheet12345" }],
  ] as const) {
    expect(
      (await operate(credential.brokerToken, operation, extra)).status,
    ).toBe(200);
  }
  expect(upstream).toHaveBeenCalledTimes(6);
});

test("expired broker credentials remain distinguishable from unknown credentials", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const { t, mint } = await setup();
  const credential = await mint();
  await t.finishAllScheduledFunctions(() =>
    vi.advanceTimersByTime(16 * 60_000),
  );
  expect(
    await t.run((ctx) => ctx.db.query("googleBrokerCredentials").collect()),
  ).toHaveLength(1);
  const expired = await t.mutation(
    internal.tables.slices.googleBroker.authorizeOperation,
    {
      brokerToken: credential.brokerToken,
      charge: false,
    },
  );
  expect(expired).toMatchObject({ ok: false, status: 403, code: "EXPIRED" });
  const unknown = await t.mutation(
    internal.tables.slices.googleBroker.authorizeOperation,
    {
      brokerToken: `gc_${"a".repeat(64)}`,
      charge: false,
    },
  );
  expect(unknown).toMatchObject({
    ok: false,
    status: 401,
    code: "UNAUTHORIZED",
  });
});

test("broker can use a valid access token repeated by Google's refresh endpoint", async () => {
  const { t, userId, mint, operate } = await setup();
  const credential = await mint();
  const connection = (await t.run((ctx) =>
    ctx.db.query("connections").unique(),
  ))!;
  const stored = (await t.query(
    internal.tables.connections.queries.getConnection,
    {
      userId,
      app: "files",
      connectionId: connection._id,
    },
  ))!;
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url, options) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return json({
          access_token: stored.accessToken,
          expires_in: 3600,
          scope: scopes.join(" "),
        });
      }
      expect(JSON.stringify(options?.headers)).toContain(stored.accessToken);
      return json({ documentId: "document123" });
    });
  const result = await operate(credential.brokerToken, "docs.get", {
    id: "document123",
  });
  expect(result.status).toBe(200);
  expect(JSON.stringify(await result.json())).not.toContain(stored.accessToken);
  expect(upstream).toHaveBeenCalledTimes(2);
});

test("broker reports refresh-lease contention as retryable", async () => {
  const { t, userId, mint, operate } = await setup();
  const credential = await mint();
  const connection = (await t.run((ctx) =>
    ctx.db.query("connections").unique(),
  ))!;
  expect(
    await t.mutation(internal.tables.connections.mutations.beginRefresh, {
      userId,
      app: "files",
      connectionId: connection._id,
      grantVersion: connection.grantVersion,
      lease: "held-by-another-request",
    }),
  ).toBe(true);
  const response = await operate(credential.brokerToken, "docs.get", {
    id: "document123",
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    code: "PROVIDER_ERROR",
    retryable: true,
  });
});

test("Drive rejects Docs and Sheets content and permits a binary file", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const { mint, operate } = await setup();
  const credential = await mint();
  let mimeType = "application/vnd.google-apps.document";
  let issued = 0;
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url, options) => {
      const target = String(url);
      if (target === "https://oauth2.googleapis.com/token")
        return json({
          access_token: `fresh-drive-${++issued}`,
          expires_in: 3600,
          scope: scopes.join(" "),
        });
      expect(JSON.stringify(options?.headers)).toContain("fresh-drive-");
      if (target.includes("alt=media")) return new Response("PDF data");
      return json({ id: "file12345", name: "file", mimeType });
    });
  expect(
    (
      await operate(credential.brokerToken, "drive.download", {
        id: "file12345",
      })
    ).status,
  ).toBe(403);
  mimeType = "application/vnd.google-apps.spreadsheet";
  expect(
    (
      await operate(credential.brokerToken, "drive.download", {
        id: "file12345",
      })
    ).status,
  ).toBe(403);
  expect(
    upstream.mock.calls.some(([url]) => String(url).includes("alt=media")),
  ).toBe(false);
  mimeType = "application/pdf";
  const response = await operate(credential.brokerToken, "drive.download", {
    id: "file12345",
  });
  expect(response.status).toBe(200);
  expect((await response.json()).contentBase64).toBe(btoa("PDF data"));
});

test("Drive lists Docs and Sheets metadata but excludes shortcuts", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const { mint, operate } = await setup();
  const credential = await mint();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url) === "https://oauth2.googleapis.com/token")
      return json({
        access_token: "fresh-drive",
        expires_in: 3600,
        scope: scopes.join(" "),
      });
    const query = new URL(String(url)).searchParams.get("q");
    expect(query).not.toContain("application/vnd.google-apps.document");
    expect(query).not.toContain("application/vnd.google-apps.spreadsheet");
    return json({
      files: [
        {
          id: "doc12345",
          name: "Project plan",
          mimeType: "application/vnd.google-apps.document",
        },
        {
          id: "sheet12345",
          name: "Budget",
          mimeType: "application/vnd.google-apps.spreadsheet",
        },
        {
          id: "shortcut12345",
          mimeType: "application/vnd.google-apps.shortcut",
        },
        { id: "pdf12345", mimeType: "application/pdf" },
      ],
    });
  });
  const response = await operate(credential.brokerToken, "drive.list");
  expect(response.status).toBe(200);
  expect((await response.json()).data.files).toEqual([
    {
      id: "doc12345",
      name: "Project plan",
      mimeType: "application/vnd.google-apps.document",
    },
    {
      id: "sheet12345",
      name: "Budget",
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
    { id: "pdf12345", mimeType: "application/pdf" },
  ]);
});

test("Drive can inspect Docs and Sheets metadata without downloading their content", async () => {
  const { mint, operate } = await setup();
  const credential = await mint();
  let mimeType = "application/vnd.google-apps.document";
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) => {
      if (String(url) === "https://oauth2.googleapis.com/token")
        return json({
          access_token: "fresh-drive",
          expires_in: 3600,
          scope: scopes.join(" "),
        });
      return json({ id: "file12345", name: "file", mimeType });
    });
  for (const type of [
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.spreadsheet",
  ]) {
    mimeType = type;
    const response = await operate(credential.brokerToken, "drive.metadata", {
      id: "file12345",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ mimeType: type });
  }
  expect(
    upstream.mock.calls.some(([url]) => String(url).includes("alt=media")),
  ).toBe(false);
});

test("a refreshed Google token with broader scopes cannot be used by the broker", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const { mint, operate } = await setup();
  const credential = await mint();
  const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    json({
      access_token: "fresh-broad",
      expires_in: 3600,
      scope: [
        ...scopes,
        "https://www.googleapis.com/auth/userinfo.profile",
      ].join(" "),
    }),
  );
  const response = await operate(credential.brokerToken, "drive.list");
  expect(response.status).toBe(403);
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(await response.json())).not.toContain("fresh-broad");
});

test.each([
  ["drive.list", {}],
  ["docs.get", { id: "document123" }],
  ["sheets.get", { id: "sheet12345" }],
] as const)(
  "%s accepts omitted refresh scope from the combined connection",
  async (operation, args) => {
    const { mint, operate } = await setup();
    const credential = await mint({ omitRefreshScope: true });
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        if (String(url) === "https://oauth2.googleapis.com/token")
          return json({ access_token: "fresh-files", expires_in: 3600 });
        return json(
          operation === "drive.list" ? { files: [] } : { id: "resource123" },
        );
      });
    expect(
      (await operate(credential.brokerToken, operation, args)).status,
    ).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  },
);

test("disconnecting the files account stops all three operation families", async () => {
  const { t, mint, operate } = await setup();
  const credential = await mint();
  await t.run(async (ctx) => {
    const row = await ctx.db.query("connections").unique();
    if (row) await ctx.db.delete("connections", row._id);
  });
  for (const [operation, extra] of [
    ["drive.list", {}],
    ["docs.get", { id: "document123" }],
    ["sheets.get", { id: "sheet12345" }],
  ] as const) {
    expect(
      (await operate(credential.brokerToken, operation, extra)).status,
    ).toBe(403);
  }
});

test("reconnecting the same Google account invalidates its older broker credential", async () => {
  const { t, userId, mint, operate } = await setup();
  const old = await mint();
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId,
    provider: "google",
    app: "files",
    accessToken: "new-standing",
    refreshToken: "new-refresh",
    login: "owner@example.com",
    providerUserId: "google-user",
    grantedScopes: scopes,
  });
  expect(
    (await operate(old.brokerToken, "docs.get", { id: "document123" })).status,
  ).toBe(403);
  const fresh = await mint();
  expect(fresh.brokerToken).not.toBe(old.brokerToken);
});

test("broker enforces expiry, request size, and fixed operation URLs", async () => {
  const { t, mint, operate } = await setup();
  const credential = await mint();
  const upstream = vi.spyOn(globalThis, "fetch");
  expect(
    (
      await operate(credential.brokerToken, "docs.get", {
        id: "https://evil.example/",
      })
    ).status,
  ).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
  const oversized = await t.fetch("/api/google/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brokerToken: credential.brokerToken,
      operation: "docs.create",
      payload: { title: "x".repeat(70_000) },
    }),
  });
  expect(oversized.status).toBe(413);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("googleBrokerCredentials").unique();
    if (row)
      await ctx.db.patch("googleBrokerCredentials", row._id, {
        expiresAt: Date.now() - 1,
      });
  });
  expect(
    (await operate(credential.brokerToken, "docs.get", { id: "document123" }))
      .status,
  ).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});

test("revoking the agent lineage stops an existing broker credential", async () => {
  const { t, fixture, mint, operate } = await setup();
  const credential = await mint();
  await t.run(async (ctx) => {
    const slice = await ctx.db.get("slices", fixture.id);
    const agent = await ctx.db
      .query("agentConnections")
      .withIndex("by_agentId_status", (q) =>
        q.eq("agentId", slice!.agentId).eq("status", "active"),
      )
      .unique();
    if (agent)
      await ctx.db.patch("agentConnections", agent._id, { status: "revoked" });
  });
  expect(
    (await operate(credential.brokerToken, "sheets.get", { id: "sheet12345" }))
      .status,
  ).toBe(403);
});

test("broker rate limit is shared across credentials on the same slice", async () => {
  const { t, mint } = await setup();
  const first = await mint();
  const second = await mint();
  for (let i = 0; i < 30; i++) {
    const result = await t.mutation(
      internal.tables.slices.googleBroker.authorizeOperation,
      {
        brokerToken: i % 2 ? first.brokerToken : second.brokerToken,
        charge: true,
      },
    );
    expect(result.ok).toBe(true);
  }
  expect(
    await t.mutation(internal.tables.slices.googleBroker.authorizeOperation, {
      brokerToken: first.brokerToken,
      charge: true,
    }),
  ).toMatchObject({ ok: false, status: 429, code: "PROVIDER_ERROR" });
});
