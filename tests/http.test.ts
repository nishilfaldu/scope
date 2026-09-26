/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

async function createSlice(
  test: ReturnType<typeof t>,
  args: {
    name: string;
    ttlMs: number;
    apps: (
      | "github"
      | "gmail"
      | "calendar"
      | "drive"
      | "docs"
      | "sheets"
      | "slack"
      | "airtable"
      | "notion"
      | "linear"
      | "vercel"
      | "zoom"
    )[];
  },
) {
  const userId = await test.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Nishil Faldu",
      email: "nishil@example.com",
    });
  });
  await test.run(async (ctx) => {
    for (const app of args.apps) {
      const provider = [
        "gmail",
        "calendar",
        "drive",
        "docs",
        "sheets",
      ].includes(app)
        ? "google"
        : app;
      await ctx.db.insert("connections", {
        userId,
        app,
        accessToken: `${app}-token`,
        login: "nishil",
        providerUserId: `${provider}-1`,
        grantVersion: 1,
      });
    }
  });
  return await test
    .withIdentity({ subject: `${userId}|session-1` })
    .mutation(internal.tables.slices.mutations.createFixture, args);
}

describe("GET /api/health", () => {
  test("returns ok without secrets", async () => {
    const response = await t().fetch("/api/health", { method: "GET" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      oauth: {
        github: false,
        google: false,
        slack: false,
        airtable: false,
        notion: false,
        linear: false,
        vercel: false,
        zoom: false,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/ghs_|ya29|xoxp|CLIENT_SECRET/);
  });
});

describe("removed routes", () => {
  test("github webhook is gone", async () => {
    const response = await t().fetch("/api/github/webhook", { method: "POST" });
    expect(response.status).toBe(404);
  });
});

describe("GET /", () => {
  test("returns the discovery spec for every public route", async () => {
    const response = await t().fetch("/", { method: "GET" });
    expect(response.status).toBe(200);
    const body = await response.json();
    const paths = body.routes.map(
      (route: { method: string; path: string }) =>
        `${route.method} ${route.path}`,
    );
    expect(paths).toContain("GET /");
    expect(paths).toContain("GET /api/health");
    expect(paths).toContain("POST /api/credentials");
    expect(paths).toContain("GET /api/apps");
    expect(paths).toContain("GET /api/accounts");
    expect(body.errors).toContain("APP_UNAVAILABLE");
  });
});

describe("GET /api/credentials", () => {
  test("is gone; the root spec replaced it", async () => {
    const response = await t().fetch("/api/credentials", { method: "GET" });
    expect(response.status).toBe(404);
  });
});

describe("OPTIONS", () => {
  test.each(["/api/credentials", "/api/apps", "/api/accounts"])(
    "%s returns 204 with an empty body",
    async (path) => {
      const response = await t().fetch(path, { method: "OPTIONS" });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    },
  );
});

describe("POST /api/credentials denials", () => {
  test("invalid JSON is invalid_request", async () => {
    const malformed = await t().fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: "Invalid JSON body",
      code: "INVALID_REQUEST",
    });
  });

  test("unknown and off apps share one code and error text", async () => {
    const test = t();
    const created = await createSlice(test, {
      name: "Keyed",
      ttlMs: 60_000,
      apps: ["slack"],
    });
    const unavailable = {
      error: "This app is not available to this slice",
      code: "APP_UNAVAILABLE",
    };
    const unknown = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "dropbox",
      }),
    });
    expect(unknown.status).toBe(403);
    expect(await unknown.json()).toMatchObject(unavailable);
    const off = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      }),
    });
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject(unavailable);
  });

  test("wrong slice secret is unauthorized and does not name the app", async () => {
    const test = t();
    const created = await createSlice(test, {
      name: "Keyed",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const response = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: "ss_wrong",
        app: "github",
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: "Unknown slice token or slice secret",
      code: "UNAUTHORIZED",
    });
  });
});

describe("GET /api/apps", () => {
  test("wrong or missing slice secret does not leak apps", async () => {
    const test = t();
    const created = await createSlice(test, {
      name: "Secret",
      ttlMs: 60_000,
      apps: ["github", "slack"],
    });
    const wrong = await test.fetch("/api/apps", {
      method: "GET",
      headers: {
        "x-slice-token": created.sliceToken,
        "x-slice-secret": "ss_wrong",
      },
    });
    expect(wrong.status).toBe(401);
    const wrongBody = await wrong.json();
    expect(wrongBody).toMatchObject({
      error: "Unknown slice token or slice secret",
      code: "UNAUTHORIZED",
    });
    expect(wrongBody).not.toHaveProperty("apps");
    expect(JSON.stringify(wrongBody)).not.toMatch(/github|slack/);

    const missing = await test.fetch("/api/apps", {
      method: "GET",
      headers: { "x-slice-token": created.sliceToken },
    });
    expect(missing.status).toBe(400);
    const missingBody = await missing.json();
    expect(missingBody).toMatchObject({
      error: "x-slice-secret must be a string",
      code: "INVALID_REQUEST",
    });
    expect(missingBody).not.toHaveProperty("apps");
    expect(JSON.stringify(missingBody)).not.toMatch(/github|slack/);
  });

  test("returns grant permission and owned connection state for each app", async () => {
    const test = t();
    const created = await createSlice(test, {
      name: "Mix",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const userId = await test.run(async (ctx) => {
      const slice = await ctx.db.get("slices", created.id);
      if (!slice) throw new Error("slice missing");
      return slice.userId;
    });
    const slice = await test
      .withIdentity({ subject: `${userId}|session-1` })
      .query(api.tables.slices.queries.get, { sliceId: created.id });
    expect(slice).not.toBeNull();
    const response = await test.fetch("/api/apps", {
      method: "GET",
      headers: {
        "x-slice-token": created.sliceToken,
        "x-slice-secret": created.sliceSecret,
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      expiresAt: slice!.expiresAt,
      apps: [
        { app: "github", allowed: true, connected: true },
        { app: "gmail", allowed: false, connected: false },
        { app: "calendar", allowed: false, connected: false },
        { app: "drive", allowed: false, connected: false },
        { app: "docs", allowed: false, connected: false },
        { app: "sheets", allowed: false, connected: false },
        { app: "slack", allowed: false, connected: false },
        { app: "airtable", allowed: false, connected: false },
        { app: "notion", allowed: false, connected: false },
        { app: "linear", allowed: false, connected: false },
        { app: "vercel", allowed: false, connected: false },
        { app: "zoom", allowed: false, connected: false },
      ],
    });
  });
});

describe("GET /api/accounts", () => {
  test("returns only allowed accounts and requires the slice secret", async () => {
    const test = t();
    const created = await createSlice(test, {
      name: "Account discovery",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const headers = {
      "x-slice-token": created.sliceToken,
      "x-slice-secret": created.sliceSecret,
    };
    const response = await test.fetch("/api/accounts?app=github", {
      method: "GET",
      headers,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      app: "github",
      accounts: [
        expect.objectContaining({
          login: "nishil",
          bindingId: expect.any(String),
        }),
      ],
    });
    const other = await test.fetch("/api/accounts?app=gmail", {
      method: "GET",
      headers,
    });
    expect(await other.json()).toEqual({ app: "gmail", accounts: [] });
    const denied = await test.fetch("/api/accounts?app=github", {
      method: "GET",
      headers: { ...headers, "x-slice-secret": "ss_wrong" },
    });
    expect(denied.status).toBe(401);
    expect(await denied.json()).not.toHaveProperty("accounts");
  });
});
