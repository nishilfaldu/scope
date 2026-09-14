/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { resolveReturnTo } from "../convex/httpOauth";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

describe("GET /api/health", () => {
  test("returns ok without secrets", async () => {
    const response = await t().fetch("/api/health", { method: "GET" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      oauth: { github: false, google: false, slack: false },
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

describe("GET /api/credentials", () => {
  test("returns the POST body schema and success shape", async () => {
    const response = await t().fetch("/api/credentials", { method: "GET" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "POST",
      body: {
        type: "object",
        required: ["passportId", "invokeKey", "app"],
        properties: {
          passportId: { type: "string" },
          invokeKey: { type: "string" },
          app: {
            type: "string",
            enum: [
              "github",
              "gmail",
              "calendar",
              "drive",
              "docs",
              "sheets",
              "slack",
            ],
          },
          refresh: { type: "boolean" },
        },
      },
      success: {
        type: "object",
        required: [
          "accessToken",
          "tokenType",
          "app",
          "expiresAt",
          "expiresIn",
        ],
        properties: {
          accessToken: { type: "string" },
          tokenType: { type: "string", const: "Bearer" },
          app: {
            type: "string",
            enum: [
              "github",
              "gmail",
              "calendar",
              "drive",
              "docs",
              "sheets",
              "slack",
            ],
          },
          expiresAt: { type: "number" },
          expiresIn: { type: "number" },
        },
      },
    });
  });
});

describe("OPTIONS", () => {
  test.each(["/api/credentials", "/api/apps"])(
    "%s returns 204 with an empty body",
    async (path) => {
      const response = await t().fetch(path, { method: "OPTIONS" });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    },
  );
});

describe("POST /api/credentials denials", () => {
  test("invalid JSON and a non-boolean refresh are invalid_request", async () => {
    const test = t();
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "Keyed",
      ttlMs: 60_000,
      apps: ["slack"],
    });
    const malformed = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: "Invalid JSON body",
      code: "INVALID_REQUEST",
    });
    const refresh = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passportId: created.passportId,
        invokeKey: created.invokeKey,
        app: "slack",
        refresh: "yes",
      }),
    });
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toEqual({
      error: "refresh must be a boolean",
      code: "INVALID_REQUEST",
    });
  });

  test("unknown and off apps share one code and error text", async () => {
    const test = t();
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "Keyed",
      ttlMs: 60_000,
      apps: ["slack"],
    });
    const unavailable = {
      error: "This app is not available on this passport",
      code: "APP_UNAVAILABLE",
    };
    const unknown = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passportId: created.passportId,
        invokeKey: created.invokeKey,
        app: "dropbox",
      }),
    });
    expect(unknown.status).toBe(403);
    expect(await unknown.json()).toEqual(unavailable);
    const off = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passportId: created.passportId,
        invokeKey: created.invokeKey,
        app: "github",
      }),
    });
    expect(off.status).toBe(403);
    expect(await off.json()).toEqual(unavailable);
  });

  test("wrong invoke key is unauthorized and does not name the app", async () => {
    const test = t();
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "Keyed",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const response = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passportId: created.passportId,
        invokeKey: "ik_wrong",
        app: "github",
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unknown passport or invoke key",
      code: "UNAUTHORIZED",
    });
  });
});

describe("GET /api/apps", () => {
  test("wrong or missing invoke key does not leak apps", async () => {
    const test = t();
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "Secret",
      ttlMs: 60_000,
      apps: ["github", "slack"],
    });
    const wrong = await test.fetch("/api/apps", {
      method: "GET",
      headers: {
        passportId: created.passportId,
        invokeKey: "ik_wrong",
      },
    });
    expect(wrong.status).toBe(401);
    const wrongBody = await wrong.json();
    expect(wrongBody).toEqual({
      error: "Unknown passport or invoke key",
      code: "UNAUTHORIZED",
    });
    expect(wrongBody).not.toHaveProperty("apps");
    expect(JSON.stringify(wrongBody)).not.toMatch(/github|slack/);

    const missing = await test.fetch("/api/apps", {
      method: "GET",
      headers: { passportId: created.passportId },
    });
    expect(missing.status).toBe(400);
    const missingBody = await missing.json();
    expect(missingBody).toEqual({
      error: "invokeKey must be a string",
      code: "INVALID_REQUEST",
    });
    expect(missingBody).not.toHaveProperty("apps");
    expect(JSON.stringify(missingBody)).not.toMatch(/github|slack/);
  });

  test("returns on vs off for each app and the passport expiry", async () => {
    const test = t();
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "Mix",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const passport = await test.query(api.tables.passports.queries.get, {
      passportId: created.id,
    });
    expect(passport).not.toBeNull();
    const response = await test.fetch("/api/apps", {
      method: "GET",
      headers: {
        passportId: created.passportId,
        invokeKey: created.invokeKey,
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      expiresAt: passport!.expiresAt,
      apps: [
        { app: "github", status: "on" },
        { app: "gmail", status: "off" },
        { app: "calendar", status: "off" },
        { app: "drive", status: "off" },
        { app: "docs", status: "off" },
        { app: "sheets", status: "off" },
        { app: "slack", status: "off" },
      ],
    });
  });
});

describe("OAuth returnTo", () => {
  test("localhost stays allowed and BOARD_ORIGIN is the deployed board", () => {
    expect(resolveReturnTo("https://evil.example/phish", null)).toBe(
      "http://localhost:3000/connections",
    );
    expect(
      resolveReturnTo("https://evil.example/phish", "https://board.example"),
    ).toBe("https://board.example/connections");
    expect(
      resolveReturnTo(
        "https://board.example/connections",
        "https://board.example",
      ),
    ).toBe("https://board.example/connections");
    expect(resolveReturnTo("http://localhost:3000/", null)).toBe(
      "http://localhost:3000/",
    );
  });
});
