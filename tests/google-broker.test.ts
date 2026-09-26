/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const scopes = (app: "drive" | "docs" | "sheets") => [
  "openid",
  "email",
  "profile",
  `https://www.googleapis.com/auth/${app === "docs" ? "documents" : app === "sheets" ? "spreadsheets" : "drive"}`,
];
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

async function setup(apps: ("drive" | "docs" | "sheets")[]) {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { name: "Owner", email: "owner@example.com" }),
  );
  for (const app of apps) {
    await t.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      provider: "google",
      app,
      accessToken: `standing-${app}`,
      refreshToken: `refresh-${app}`,
      login: "owner@example.com",
      providerUserId: "google-user",
      grantedScopes: scopes(app),
    });
  }
  const fixture = await t
    .withIdentity({ subject: `${userId}|session-1` })
    .mutation(internal.tables.slices.mutations.createFixture, {
      name: "Google",
      ttlMs: 60_000,
      apps,
      mintPolicy: "auto",
    });
  const mint = async (
    app: "drive" | "docs" | "sheets",
    options: { omitRefreshScope?: boolean } = {},
  ) => {
    const refresh = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        access_token: `minted-${app}-${crypto.randomUUID()}`,
        expires_in: 3600,
        ...(options.omitRefreshScope ? {} : { scope: scopes(app).join(" ") }),
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("Drive mint returns only an opaque credential and refuses Docs and Sheets operations", async () => {
  const { mint, operate } = await setup(["drive"]);
  const credential = await mint("drive");
  expect(credential).toMatchObject({
    app: "drive",
    brokerToken: expect.stringMatching(/^gc_/),
  });
  expect(credential).not.toHaveProperty("accessToken");
  const upstream = vi.spyOn(globalThis, "fetch");
  expect(
    (await operate(credential.brokerToken, "docs.get", { id: "document123" }))
      .status,
  ).toBe(400);
  expect(
    (
      await operate(credential.brokerToken, "sheets.get", {
        id: "spreadsheet123",
      })
    ).status,
  ).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});

test("Drive rejects Docs and Sheets content and permits a binary file", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const { mint, operate } = await setup(["drive"]);
  const credential = await mint("drive");
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
          scope: scopes("drive").join(" "),
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

test("Drive listing filters Google Workspace files even if upstream returns them", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const { mint, operate } = await setup(["drive"]);
  const credential = await mint("drive");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url) === "https://oauth2.googleapis.com/token")
      return json({
        access_token: "fresh-drive",
        expires_in: 3600,
        scope: scopes("drive").join(" "),
      });
    return json({
      files: [
        { id: "doc12345", mimeType: "application/vnd.google-apps.document" },
        {
          id: "sheet12345",
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
    { id: "pdf12345", mimeType: "application/pdf" },
  ]);
});

test("a refreshed Google token with broader scopes cannot be used by the broker", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const { mint, operate } = await setup(["drive"]);
  const credential = await mint("drive");
  const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    json({
      access_token: "fresh-broad",
      expires_in: 3600,
      scope: [
        ...scopes("drive"),
        "https://www.googleapis.com/auth/spreadsheets",
      ].join(" "),
    }),
  );
  const response = await operate(credential.brokerToken, "drive.list");
  expect(response.status).toBe(403);
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(await response.json())).not.toContain("fresh-broad");
});

test.each([
  ["drive", "drive.list", {}],
  ["docs", "docs.get", { id: "document123" }],
  ["sheets", "sheets.get", { id: "sheet12345" }],
] as const)(
  "%s broker mint and operation accept omitted refresh scope from a bounded connection",
  async (app, operation, args) => {
    const { mint, operate } = await setup([app]);
    const credential = await mint(app, { omitRefreshScope: true });
    expect(credential.brokerToken).toMatch(/^gc_/);
    expect(credential).not.toHaveProperty("accessToken");
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, options) => {
        if (String(url) === "https://oauth2.googleapis.com/token") {
          return json({
            access_token: `fresh-${app}-without-scope`,
            expires_in: 3600,
          });
        }
        expect(JSON.stringify(options?.headers)).toContain(
          `fresh-${app}-without-scope`,
        );
        return json(
          app === "drive"
            ? { files: [{ id: "pdf12345", mimeType: "application/pdf" }] }
            : { id: "resource123" },
        );
      });
    const response = await operate(credential.brokerToken, operation, args);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(
      `fresh-${app}-without-scope`,
    );
    expect(upstream).toHaveBeenCalledTimes(2);
  },
);

test("Docs, Sheets, and Drive use separate accounts; disconnect and revocation stop only their capabilities", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const { t, fixture, mint, operate } = await setup([
    "drive",
    "docs",
    "sheets",
  ]);
  const drive = await mint("drive"),
    docs = await mint("docs"),
    sheets = await mint("sheets");
  let issued = 0;
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url, options) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        const refresh = new URLSearchParams(String(options?.body)).get(
          "refresh_token",
        )!;
        const app = refresh.split("-")[1] as "drive" | "docs" | "sheets";
        return json({
          access_token: `fresh-${app}-${++issued}`,
          expires_in: 3600,
          scope: scopes(app).join(" "),
        });
      }
      return json({ id: "document123", title: "hello" });
    });
  expect(
    (await operate(docs.brokerToken, "docs.get", { id: "document123" })).status,
  ).toBe(200);
  expect(
    (await operate(sheets.brokerToken, "sheets.get", { id: "spreadsheet123" }))
      .status,
  ).toBe(200);
  expect(
    (await operate(drive.brokerToken, "docs.get", { id: "document123" }))
      .status,
  ).toBe(400);
  expect(
    upstream.mock.calls.some(
      ([url, options]) =>
        String(url).includes("docs.googleapis.com") &&
        JSON.stringify(options).includes("fresh-drive"),
    ),
  ).toBe(false);
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("connections").take(10)).find(
      (connection) => connection.app === "docs",
    );
    if (row) await ctx.db.delete("connections", row._id);
  });
  expect(
    (await operate(docs.brokerToken, "docs.get", { id: "document123" })).status,
  ).toBe(403);
  expect(
    (await operate(sheets.brokerToken, "sheets.get", { id: "spreadsheet123" }))
      .status,
  ).toBe(200);
  await t.run(async (ctx) => {
    await ctx.db.patch("slices", fixture.id, { status: "revoked" });
  });
  expect(
    (await operate(sheets.brokerToken, "sheets.get", { id: "spreadsheet123" }))
      .status,
  ).toBe(403);
});

test("reconnecting the same Google account invalidates its older broker credential", async () => {
  const { t, userId, mint, operate } = await setup(["docs"]);
  const old = await mint("docs");
  await t.mutation(internal.tables.connections.mutations.saveConnection, {
    userId,
    provider: "google",
    app: "docs",
    accessToken: "new-standing",
    refreshToken: "new-refresh",
    login: "owner@example.com",
    providerUserId: "google-user",
    grantedScopes: scopes("docs"),
  });
  expect(
    (await operate(old.brokerToken, "docs.get", { id: "document123" })).status,
  ).toBe(403);
  const fresh = await mint("docs");
  expect(fresh.brokerToken).not.toBe(old.brokerToken);
});

test("broker enforces expiry, request size, and fixed operation URLs", async () => {
  const { t, mint, operate } = await setup(["docs"]);
  const credential = await mint("docs");
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
  const { t, fixture, mint, operate } = await setup(["sheets"]);
  const credential = await mint("sheets");
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
  const { t, mint } = await setup(["docs"]);
  const first = await mint("docs");
  const second = await mint("docs");
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
  ).toEqual({ ok: false, rateLimited: true });
});
