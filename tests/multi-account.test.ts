/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const t = () => convexTest(schema, modules);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("app-bound OAuth state", () => {
  test("a Gmail state cannot start the Calendar connect route", async () => {
    vi.stubEnv("BOARD_ORIGIN", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "shared-client");
    vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
    const test = t();
    const userId = await test.run(async (ctx) =>
      ctx.db.insert("users", { name: "Owner", email: "owner@example.com" }),
    );
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    const { state } = await backend.mutation(
      api.tables.oauthStates.mutations.start,
      {
        app: "gmail",
        returnTo: "http://localhost:3000/connections",
      },
    );
    expect(
      (await test.fetch(`/api/calendar/connect?state=${state}`)).status,
    ).toBe(400);
    const response = await test.fetch(`/api/gmail/connect?state=${state}`);
    expect(response.status).toBe(302);
    expect(
      new URL(response.headers.get("location")!).searchParams.get(
        "redirect_uri",
      ),
    ).toBe("https://scope.convex.site/api/gmail/callback");
  });
});

describe("Google disconnect", () => {
  test("disconnect is local even for the last Google connection", async () => {
    const test = t();
    const userId = await test.run(async (ctx) =>
      ctx.db.insert("users", { name: "Owner", email: "owner@example.com" }),
    );
    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      provider: "google",
      app: "gmail",
      providerUserId: "sub-x",
      login: "x@gmail.com",
      accessToken: "access-x",
      refreshToken: "refresh-x",
    });
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    const status = (
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["gmail"],
      })
    ).find((row) => row.app === "gmail")!;
    const upstream = vi.spyOn(globalThis, "fetch");
    await backend.action(api.tables.connections.actions.disconnect, {
      app: "gmail",
      connectionId: status.accounts[0].id,
    });
    const after = (
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["gmail"],
      })
    ).find((row) => row.app === "gmail")!;
    expect(upstream).not.toHaveBeenCalled();
    expect(after).toEqual({
      provider: "google",
      app: "gmail",
      connected: false,
      accounts: [],
    });
  });

  test("removing one app preserves other Google app connections", async () => {
    const test = t();
    const userId = await test.run(async (ctx) =>
      ctx.db.insert("users", { name: "Owner", email: "owner@example.com" }),
    );
    for (const app of ["gmail", "calendar"] as const) {
      await test.mutation(
        internal.tables.connections.mutations.saveConnection,
        {
          userId,
          provider: "google",
          app,
          providerUserId: `${app}:service-id`,
          login: "x@gmail.com",
          accessToken: `access-${app}`,
          refreshToken: `refresh-${app}`,
        },
      );
    }
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    const statuses = await backend.query(
      api.tables.connections.queries.statusesForApps,
      { apps: ["gmail", "calendar"] },
    );
    const gmailId = statuses.find((row) => row.app === "gmail")!.accounts[0].id;
    const calendarId = statuses.find((row) => row.app === "calendar")!
      .accounts[0].id;
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    await backend.action(api.tables.connections.actions.disconnect, {
      app: "gmail",
      connectionId: gmailId,
    });
    expect(upstream).not.toHaveBeenCalled();
    expect(
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["gmail", "calendar"],
      }),
    ).toEqual([
      { provider: "google", app: "gmail", connected: false, accounts: [] },
      {
        provider: "google",
        app: "calendar",
        connected: true,
        accounts: [
          expect.objectContaining({
            id: calendarId,
            login: "x@gmail.com",
            providerUserId: "calendar:service-id",
          }),
        ],
      },
    ]);
    await backend.action(api.tables.connections.actions.disconnect, {
      app: "calendar",
      connectionId: calendarId,
    });
    expect(upstream).not.toHaveBeenCalled();
    expect(
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["gmail", "calendar"],
      }),
    ).toEqual([
      { provider: "google", app: "gmail", connected: false, accounts: [] },
      {
        provider: "google",
        app: "calendar",
        connected: false,
        accounts: [],
      },
    ]);
  });
});

describe("multi-account bindings", () => {
  test("one slice allows two Gmail accounts and pins approval to the chosen binding", async () => {
    const test = t();
    const userId = await test.run(async (ctx) =>
      ctx.db.insert("users", { name: "Owner", email: "owner@example.com" }),
    );
    for (const [providerUserId, login] of [
      ["sub-x", "x@gmail.com"],
      ["sub-y", "y@gmail.com"],
    ] as const) {
      await test.mutation(
        internal.tables.connections.mutations.saveConnection,
        {
          userId,
          provider: "google",
          app: "gmail",
          providerUserId,
          login,
          accessToken: `access-${providerUserId}`,
          refreshToken: `refresh-${providerUserId}`,
        },
      );
    }
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    const accounts = (
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["gmail"],
      })
    )[0].accounts;
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Both accounts",
        ttlMs: 60_000,
        apps: ["gmail"],
        mintPolicy: "approve",
        bindings: accounts.map((account) => ({
          app: "gmail" as const,
          connectionId: account.id,
        })),
      },
    );
    const discovered = await test.query(
      internal.tables.slices.queries.discoverAccounts,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "gmail",
        now: Date.now(),
      },
    );
    if (!discovered.ok) throw new Error("expected account discovery");
    expect(discovered.accounts.map((account) => account.login)).toEqual([
      "x@gmail.com",
      "y@gmail.com",
    ]);
    const ambiguous = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "gmail",
      },
    );
    expect(ambiguous).toMatchObject({
      ok: false,
      code: "ACCOUNT_SELECTION_REQUIRED",
    });
    const selected = discovered.accounts[1];
    const authorized = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "gmail",
        bindingId: selected.bindingId,
      },
    );
    expect(authorized).toMatchObject({
      ok: true,
      bindingId: selected.bindingId,
      connectionId: accounts[1].id,
    });
    if (!authorized.ok) throw new Error("expected authorization");
    const pending = await test.mutation(
      internal.tables.slices.tokenRequestClaims.createPending,
      {
        sliceId: authorized.sliceId,
        app: "gmail",
        bindingId: authorized.bindingId,
      },
    );
    if (!pending.ok) throw new Error("expected pending request");
    const boardRequest = await backend.query(
      api.tables.slices.tokenRequests.get,
      {
        publicToken: pending.publicToken,
      },
    );
    expect(boardRequest?.accountLogin).toBe("y@gmail.com");
    await backend.mutation(api.tables.slices.tokenRequests.decide, {
      publicToken: pending.publicToken,
      decision: "approved",
    });
    const claim = await test.mutation(
      internal.tables.slices.tokenRequestClaims.resolveClaim,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId: pending.requestId,
      },
    );
    expect(claim).toMatchObject({
      ok: true,
      bindingId: selected.bindingId,
      connectionId: accounts[1].id,
    });
    await backend.mutation(api.tables.slices.mutations.setBinding, {
      sliceToken: created.sliceToken,
      app: "gmail",
      connectionId: accounts[1].id,
      enabled: false,
    });
    const unavailable = await test.mutation(
      internal.tables.slices.tokenRequestClaims.resolveClaim,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId: pending.requestId,
      },
    );
    expect(unavailable).toMatchObject({ ok: false, code: "APP_UNAVAILABLE" });
    const stillAllowed = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "gmail",
      },
    );
    expect(stillAllowed).toMatchObject({
      ok: true,
      connectionId: accounts[0].id,
    });
  });

  test("rejects a connection without a stable provider account ID", async () => {
    const test = t();
    const userId = await test.run(async (ctx) =>
      ctx.db.insert("users", { name: "Owner", email: "owner@example.com" }),
    );
    await expect(
      test.mutation(internal.tables.connections.mutations.saveConnection, {
        userId,
        provider: "google",
        app: "gmail",
        providerUserId: "",
        login: "x@gmail.com",
        accessToken: "access-x",
      }),
    ).rejects.toThrow("Provider account ID is required");
  });

  test("keeps two accounts, requires a selection, and binds the selected account", async () => {
    const test = t();
    const userId = await test.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        name: "Owner",
        email: "owner@example.com",
      });
      return id;
    });
    for (const [providerUserId, login] of [
      ["sub-x", "x@gmail.com"],
      ["sub-y", "y@gmail.com"],
    ] as const) {
      await test.mutation(
        internal.tables.connections.mutations.saveConnection,
        {
          userId,
          provider: "google",
          app: "gmail",
          providerUserId,
          login,
          accessToken: `access-${providerUserId}`,
          refreshToken: `refresh-${providerUserId}`,
        },
      );
    }
    // Reconnecting the same stable subject updates that account instead of adding a third row.
    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      provider: "google",
      app: "gmail",
      providerUserId: "sub-x",
      login: "renamed@gmail.com",
      accessToken: "access-new",
      refreshToken: "refresh-new",
    });
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    const status = (
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["gmail"],
      })
    ).find((row) => row.app === "gmail")!;
    expect(status.accounts.map((account) => account.login)).toEqual([
      "renamed@gmail.com",
      "y@gmail.com",
    ]);
    const page = await backend.query(
      api.tables.connections.queries.statusesForApps,
      { apps: ["gmail", "calendar"] },
    );
    expect(page.map((entry) => [entry.app, entry.accounts.length])).toEqual([
      ["gmail", 2],
      ["calendar", 0],
    ]);
    await expect(
      backend.mutation(internal.tables.slices.mutations.createFixture, {
        name: "Agent",
        ttlMs: 60_000,
        apps: ["gmail"],
      }),
    ).rejects.toThrow("Select at least one account");
    const selected = status.accounts[1].id;
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Agent",
        ttlMs: 60_000,
        apps: ["gmail"],
        bindings: [{ app: "gmail", connectionId: selected }],
      },
    );
    const grant = await test.run(async (ctx) => {
      const slice = await ctx.db.get("slices", created.id);
      return slice
        ? await ctx.db
            .query("sliceBindings")
            .withIndex("by_slice_app_connectionId", (q) =>
              q.eq("sliceId", slice._id),
            )
            .collect()
        : null;
    });
    expect(grant).toMatchObject([{ app: "gmail", connectionId: selected }]);
    const authorized = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "gmail",
      },
    );
    expect(authorized).toMatchObject({ ok: true, connectionId: selected });
    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      provider: "google",
      app: "calendar",
      providerUserId: "sub-x",
      login: "renamed@gmail.com",
      accessToken: "calendar-token",
      refreshToken: "calendar-refresh",
    });
    const before = await test.query(
      internal.tables.slices.queries.discoverApps,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        now: Date.now(),
      },
    );
    expect(
      before.ok && before.apps.find((app) => app.app === "calendar"),
    ).toMatchObject({ allowed: false, connected: false });
    await test.mutation(internal.tables.connections.mutations.clearConnection, {
      userId,
      app: "gmail",
      connectionId: selected,
    });
    const denied = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "gmail",
      },
    );
    expect(denied).toMatchObject({ ok: false, code: "APP_UNAVAILABLE" });
    const discovery = await test.query(
      internal.tables.slices.queries.discoverApps,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        now: Date.now(),
      },
    );
    expect(
      discovery.ok && discovery.apps.find((app) => app.app === "gmail"),
    ).toMatchObject({ allowed: true, connected: false });
    expect(
      await test.mutation(
        internal.tables.connections.mutations.refreshConnection,
        {
          userId,
          app: "gmail",
          connectionId: selected,
          providerUserId: "sub-y",
          accessToken: "late-token",
          refreshToken: "late-refresh",
          grantVersion: 0,
          lease: "stale-lease",
        },
      ),
    ).toBe(false);
    const after = (
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["gmail"],
      })
    ).find((row) => row.app === "gmail")!;
    expect(after.accounts.map((account) => account.login)).toEqual([
      "renamed@gmail.com",
    ]);
  });
});
