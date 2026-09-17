/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { ensurePassport } from "../convex/tables/passports";
import { google } from "../convex/oauth/providers/google";

const modules = import.meta.glob("../convex/**/*.ts");
const t = () => convexTest(schema, modules);
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("per-app Google consent", () => {
  test.each([
    ["gmail", "gmail.modify"], ["calendar", "/calendar"],
    ["drive", "/drive"], ["docs", "/documents"], ["sheets", "/spreadsheets"],
  ] as const)("%s requests only its app scope", (app, scopeSuffix) => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "shared-client");
    vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    const started = google.authorize("state-1", app);
    if (started instanceof Promise || "error" in started) throw new Error("authorization failed");
    const url = new URL(started.url);
    expect(url.searchParams.get("client_id")).toBe("shared-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`https://passport.convex.site/api/${app}/callback`);
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toHaveLength(4);
    expect(scopes.filter((scope) => scope.startsWith("https://www.googleapis.com/auth/"))).toEqual([expect.stringContaining(scopeSuffix)]);
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
  });
});

describe("app-bound OAuth state", () => {
  test("a Gmail state cannot start the Calendar connect route", async () => {
    vi.stubEnv("BOARD_ORIGIN", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "shared-client");
    vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    const test = t();
    const userId = await test.run(async (ctx) => ctx.db.insert("users", { name: "Owner", email: "owner@example.com" }));
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    const { state } = await backend.mutation(api.tables.oauthStates.mutations.start, {
      app: "gmail", returnTo: "http://localhost:3000/connections",
    });
    expect((await test.fetch(`/api/calendar/connect?state=${state}`)).status).toBe(400);
    const response = await test.fetch(`/api/gmail/connect?state=${state}`);
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!).searchParams.get("redirect_uri"))
      .toBe("https://passport.convex.site/api/gmail/callback");
  });
});

describe("Google disconnect", () => {
  test("removing one app preserves other Google app grants", async () => {
    const test = t();
    const userId = await test.run(async (ctx) => ctx.db.insert("users", { name: "Owner", email: "owner@example.com" }));
    for (const app of ["gmail", "calendar"] as const) {
      await test.mutation(internal.tables.connections.mutations.saveConnection, {
        userId, provider: "google", app, providerUserId: "sub-x", login: "x@gmail.com",
        accessToken: `access-${app}`, refreshToken: `refresh-${app}`,
      });
    }
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    const statuses = await backend.query(api.tables.connections.queries.listStatuses, {});
    const gmailId = statuses.find((row) => row.app === "gmail")!.accounts[0].id;
    const calendarId = statuses.find((row) => row.app === "calendar")!.accounts[0].id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await backend.action(api.tables.connections.actions.disconnect, { app: "gmail", connectionId: gmailId });
    expect(fetchSpy).not.toHaveBeenCalled();
    await backend.action(api.tables.connections.actions.disconnect, { app: "calendar", connectionId: calendarId });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("multi-account grants", () => {
  test("keeps two accounts, requires a selection, and binds the selected account", async () => {
    const test = t();
    const userId = await test.run(async (ctx) => {
      const id = await ctx.db.insert("users", { name: "Owner", email: "owner@example.com" });
      await ensurePassport(ctx, id);
      return id;
    });
    for (const [providerUserId, login] of [["sub-x", "x@gmail.com"], ["sub-y", "y@gmail.com"]] as const) {
      await test.mutation(internal.tables.connections.mutations.saveConnection, {
        userId, provider: "google", app: "gmail", providerUserId, login,
        accessToken: `access-${providerUserId}`, refreshToken: `refresh-${providerUserId}`,
      });
    }
    // Reconnecting the same stable subject updates that account instead of adding a third row.
    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      userId, provider: "google", app: "gmail", providerUserId: "sub-x", login: "renamed@gmail.com",
      accessToken: "access-new", refreshToken: "refresh-new",
    });
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    const status = (await backend.query(api.tables.connections.queries.listStatuses, {})).find((row) => row.app === "gmail")!;
    expect(status.accounts.map((account) => account.login)).toEqual(["renamed@gmail.com", "y@gmail.com"]);
    await expect(backend.mutation(api.tables.slices.mutations.create, {
      name: "Agent", ttlMs: 60_000, apps: ["gmail"],
    })).rejects.toThrow("Select one account");
    const selected = status.accounts[1].id;
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Agent", ttlMs: 60_000, apps: ["gmail"], bindings: [{ app: "gmail", connectionId: selected }],
    });
    const grant = await test.run(async (ctx) => {
      const slice = await ctx.db.get("slices", created.id);
      return slice ? await ctx.db.get("grants", slice.grantId) : null;
    });
    expect(grant?.bindings).toEqual([{ app: "gmail", connectionId: selected }]);
    const authorized = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
      sliceToken: created.sliceToken, sliceSecret: created.sliceSecret, app: "gmail", refresh: false,
    });
    expect(authorized).toMatchObject({ ok: true, connectionId: selected });
    await test.mutation(internal.tables.connections.mutations.clearConnection, { userId, app: "gmail", connectionId: selected });
    const denied = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
      sliceToken: created.sliceToken, sliceSecret: created.sliceSecret, app: "gmail", refresh: false,
    });
    expect(denied).toMatchObject({ ok: false, code: "APP_UNAVAILABLE" });
    expect(await test.mutation(internal.tables.connections.mutations.refreshConnection, {
      userId, app: "gmail", connectionId: selected, providerUserId: "sub-y",
      accessToken: "late-token", refreshToken: "late-refresh",
    })).toBe(false);
    const after = (await backend.query(api.tables.connections.queries.listStatuses, {})).find((row) => row.app === "gmail")!;
    expect(after.accounts.map((account) => account.login)).toEqual(["renamed@gmail.com"]);
  });
});
