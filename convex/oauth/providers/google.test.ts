/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { google } from "./google";
import { googleScopesAreBounded, type GoogleAppId } from "../../domain/apps";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { issueShortLivedAccess } from "../access";

const modules = import.meta.glob("../../**/*.ts");
const scope = (name: string) => `https://www.googleapis.com/auth/${name}`;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const cases = [
  {
    app: "gmail",
    scope: scope("gmail.modify"),
    path: "https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress",
    raw: { emailAddress: "Owner@example.com" },
    id: "gmail:owner@example.com",
    login: "Owner@example.com",
  },
  {
    app: "calendar",
    scope: scope("calendar"),
    path: "https://www.googleapis.com/calendar/v3/calendars/primary?fields=id",
    raw: { id: "primary-calendar-id" },
    id: "calendar:primary-calendar-id",
    login: "primary-calendar-id",
  },
  {
    app: "files",
    scope: scope("drive"),
    path: "https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,me)",
    raw: {
      user: {
        permissionId: "permission-123",
        emailAddress: "owner@example.com",
        me: true,
      },
    },
    id: "drive:permission-123",
    login: "owner@example.com",
  },
] as const;

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test.each(cases)(
  "$app requests only service authority and uses its authenticated service identity",
  async (c) => {
    const started = await google.authorize("state", c.app);
    if ("error" in started) throw new Error(started.error);
    const url = new URL(started.url);
    expect(url.searchParams.get("scope")).toBe(c.scope);
    expect(url.searchParams.get("redirect_uri")).toBe(
      `https://scope.convex.site/api/${c.app}/callback`,
    );
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("access_type")).toBe("offline");
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json({
          access_token: "access",
          refresh_token: "refresh",
          scope: `  ${c.scope}\t, \n${c.scope}  `,
        }),
      )
      .mockResolvedValueOnce(json(c.raw));
    const grant = await google.exchange("code", "state", c.app);
    expect(grant).toMatchObject({
      providerUserId: c.id,
      login: c.login,
      grantedScopes: [c.scope, c.scope],
    });
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream).toHaveBeenLastCalledWith(c.path, {
      headers: { Authorization: "Bearer access" },
      redirect: "error",
    });
  },
);

test.each(cases)("$app accepts only its requested service scope", (c) => {
  expect(googleScopesAreBounded(c.app, [c.scope])).toBe(true);
  for (const extra of [
    "openid",
    "email",
    "profile",
    scope("userinfo.email"),
    scope("userinfo.profile"),
    scope("documents"),
    scope("spreadsheets"),
    scope("cloud-platform"),
    "https://mail.google.com/",
    "unknown",
    "",
    c.app === "gmail" ? scope("calendar") : scope("gmail.modify"),
  ]) {
    expect(googleScopesAreBounded(c.app, [c.scope, extra])).toBe(false);
  }
  for (const missing of [
    undefined,
    [],
    ["openid", "email"],
    [scope("drive.file")],
  ]) {
    expect(googleScopesAreBounded(c.app, missing)).toBe(false);
  }
});

test("Files rejects the old combined scope set even alongside Drive authority", () => {
  expect(
    googleScopesAreBounded("files", [
      scope("drive"),
      scope("documents"),
      scope("spreadsheets"),
    ]),
  ).toBe(false);
  expect(
    googleScopesAreBounded("files", [
      scope("documents"),
      scope("spreadsheets"),
    ]),
  ).toBe(false);
  expect(
    googleScopesAreBounded("gmail", [
      scope("gmail.modify"),
      scope("documents"),
    ]),
  ).toBe(false);
  expect(googleScopesAreBounded("github", [scope("drive")])).toBe(false);
});

test.each([
  undefined,
  null,
  42,
  "",
  "openid email",
  `${scope("gmail.modify")} ${scope("drive")}`,
])(
  "exchange rejects missing, malformed, partial or cross-app scopes (%s) before identity lookup",
  async (granted) => {
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json({ access_token: "access", scope: granted }));
    expect(await google.exchange("code", "state", "gmail")).toEqual({
      error: "scope",
    });
    expect(upstream).toHaveBeenCalledTimes(1);
  },
);

test.each(cases)(
  "$app identity HTTP, JSON, network and empty responses fail closed",
  async (c) => {
    for (const response of [
      json(c.raw, 403),
      new Response("not json"),
      json({}),
      json(null),
      json([]),
    ]) {
      vi.spyOn(globalThis, "fetch")
        .mockReset()
        .mockResolvedValueOnce(json({ access_token: "access", scope: c.scope }))
        .mockResolvedValueOnce(response);
      expect(await google.exchange("code", "state", c.app)).toEqual({
        error: "identity",
      });
    }
    vi.spyOn(globalThis, "fetch")
      .mockReset()
      .mockResolvedValueOnce(json({ access_token: "access", scope: c.scope }))
      .mockRejectedValueOnce(new Error("private upstream detail"));
    expect(await google.exchange("code", "state", c.app)).toEqual({
      error: "identity",
    });
  },
);

test.each(cases)(
  "$app rejects each removed exception at exchange and refresh",
  async (c) => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const upstream = vi.spyOn(globalThis, "fetch");
    for (const extra of [
      "openid",
      "email",
      "profile",
      scope("userinfo.email"),
      scope("userinfo.profile"),
      scope("documents"),
      scope("spreadsheets"),
    ]) {
      const scopeString = `${c.scope} ${extra}`;
      upstream
        .mockReset()
        .mockImplementation(async () =>
          json({ access_token: "rejected", scope: scopeString }),
        );
      expect(await google.exchange("code", "state", c.app)).toEqual({
        error: "scope",
      });
      expect(upstream).toHaveBeenCalledTimes(1); // No identity lookup.
      await t.mutation(internal.tables.connections.mutations.saveConnection, {
        userId,
        provider: "google",
        app: c.app,
        providerUserId: c.id,
        login: c.login,
        accessToken: "standing",
        refreshToken: "refresh",
        grantedScopes: [c.scope],
      });
      const connectionId = (await t.run((ctx) =>
        ctx.db.query("connections").unique(),
      ))!._id;
      const mint = () =>
        t.action((ctx) =>
          issueShortLivedAccess(
            ctx,
            userId,
            c.app,
            connectionId,
            c.app === "files" ? "server" : "agent",
          ),
        );
      upstream.mockClear();
      expect(await mint()).toMatchObject({ code: "APP_UNAVAILABLE" });
      expect(upstream).toHaveBeenCalledTimes(1);
      // The stored excess grant cannot be used on the next mint either.
      upstream.mockClear();
      expect(await mint()).toMatchObject({ code: "APP_UNAVAILABLE" });
      expect(upstream).not.toHaveBeenCalled();
    }
  },
);

test.each([
  ["gmail", { emailAddress: "  " }],
  ["calendar", { dataOwner: "other@example.com" }],
  ["calendar", { id: "primary" }],
  ["calendar", { id: " " }],
  ["files", { user: { emailAddress: "owner@example.com", me: true } }],
  ["files", { user: { permissionId: "id", me: false } }],
  ["files", { user: { permissionId: " ", me: true } }],
] as const)("%s refuses an unusable service key", async (app, raw) => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      json({
        access_token: "access",
        scope: cases.find((c) => c.app === app)!.scope,
      }),
    )
    .mockResolvedValueOnce(json(raw));
  expect(await google.exchange("code", "state", app)).toEqual({
    error: "identity",
  });
});

test("Files uses permission ID even when email is absent, and Calendar ignores secondary owner metadata", async () => {
  for (const [app, raw, identity] of [
    [
      "files",
      { user: { permissionId: "123", me: true } },
      { providerUserId: "drive:123", login: "Drive account 123" },
    ],
    [
      "calendar",
      { id: "calendar-id", dataOwner: "someone-else@example.com" },
      { providerUserId: "calendar:calendar-id", login: "calendar-id" },
    ],
  ] as const) {
    vi.spyOn(globalThis, "fetch")
      .mockReset()
      .mockResolvedValueOnce(
        json({
          access_token: "access",
          scope: cases.find((c) => c.app === app)!.scope,
        }),
      )
      .mockResolvedValueOnce(json(raw));
    expect(await google.exchange("code", "state", app)).toMatchObject(identity);
  }
});

test.each(cases)(
  "$app service identity deduplicates reconnect, preserves app separation and fails without saving",
  async (c) => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "owner@example.com" }),
    );
    const owner = t.withIdentity({ subject: `${userId}|session` });
    let raw: unknown = c.raw;
    let tokenScope: string = c.scope;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url) === "https://oauth2.googleapis.com/token"
        ? json({
            access_token: "access",
            refresh_token: "refresh",
            scope: tokenScope,
          })
        : json(raw),
    );
    async function connect(app: GoogleAppId) {
      const { state, browserProof } = await owner.mutation(
        api.tables.oauthStates.mutations.start,
        { app, returnTo: "http://localhost:3000/connections" },
      );
      return owner.action(api.tables.oauthStates.finish.complete, {
        app,
        state,
        browserProof,
        code: "code",
      });
    }
    expect((await connect(c.app)).connected).toBe(true);
    const first = (await t.run((ctx) => ctx.db.query("connections").unique()))!;
    expect((await connect(c.app)).connected).toBe(true);
    const second = (await t.run((ctx) =>
      ctx.db.query("connections").unique(),
    ))!;
    expect(second._id).toBe(first._id);
    expect(second.providerUserId).toBe(c.id);
    expect(second.connectionGeneration).toBe(first.connectionGeneration! + 1);
    tokenScope = `${c.scope} openid`;
    expect(await connect(c.app)).toMatchObject({
      connected: false,
      reason: "scope",
    });
    expect(await t.run((ctx) => ctx.db.get("connections", second._id))).toEqual(
      second,
    );
    tokenScope = c.scope;
    // Identical strings in another app must never merge connection rows.
    await t.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      app: c.app === "gmail" ? "calendar" : "gmail",
      provider: "google",
      providerUserId: c.id,
      login: c.login,
      accessToken: "other-access",
    });
    raw = {};
    expect(await connect(c.app)).toMatchObject({
      connected: false,
      reason: "identity",
    });
    expect(await t.run((ctx) => ctx.db.get("connections", second._id))).toEqual(
      second,
    );
    expect(
      await t.run((ctx) => ctx.db.query("connections").take(3)),
    ).toHaveLength(2);
  },
);

test.each(cases)(
  "$app mint accepts service-only refresh, inherits omitted scope, and blocks excess grants durably",
  async (c) => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      provider: "google",
      app: c.app,
      providerUserId: c.id,
      login: c.login,
      accessToken: "standing",
      refreshToken: "refresh",
      grantedScopes: [c.scope],
    });
    const connectionId = (await t.run((ctx) =>
      ctx.db.query("connections").unique(),
    ))!._id;
    const mint = () =>
      t.action((ctx) =>
        issueShortLivedAccess(ctx, userId, c.app, connectionId),
      );
    const upstream = vi.spyOn(globalThis, "fetch");
    upstream.mockResolvedValueOnce(
      json({ access_token: "fresh-omitted", expires_in: 3600 }),
    );
    expect(await mint()).toMatchObject({
      accessToken: "fresh-omitted",
      grantedScopes: [c.scope],
    });
    upstream.mockResolvedValueOnce(
      json({
        access_token: "fresh-explicit",
        scope: c.scope,
      }),
    );
    expect(await mint()).toMatchObject({
      accessToken: "fresh-explicit",
      grantedScopes: [c.scope],
    });
    const badScopes = [
      c.scope,
      c.app === "gmail" ? scope("calendar") : scope("gmail.modify"),
    ];
    upstream.mockResolvedValueOnce(
      json({
        access_token: "never-deliver",
        refresh_token: "rotated",
        scope: badScopes.join(" "),
      }),
    );
    const rejected = await mint();
    expect(rejected).toMatchObject({ code: "APP_UNAVAILABLE" });
    expect(rejected).not.toHaveProperty("accessToken");
    const saved = await t.query(
      internal.tables.connections.queries.getConnection,
      { userId, app: c.app, connectionId },
    );
    expect(saved).toMatchObject({
      providerUserId: c.id,
      refreshToken: "rotated",
      grantedScopes: badScopes,
    });
    upstream.mockClear();
    expect(await mint()).toMatchObject({ code: "APP_UNAVAILABLE" });
    expect(upstream).not.toHaveBeenCalled();
  },
);
