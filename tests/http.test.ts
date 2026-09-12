/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

describe("GET /api/credentials", () => {
  test("returns the POST body schema and success shape", async () => {
    const response = await t().fetch("/api/credentials", { method: "GET" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "POST",
      body: {
        type: "object",
        required: ["passportId", "invokeKey", "platform"],
        properties: {
          passportId: { type: "string" },
          invokeKey: { type: "string" },
          platform: {
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
          "platform",
          "expiresAt",
          "expiresIn",
        ],
        properties: {
          accessToken: { type: "string" },
          tokenType: { type: "string", const: "Bearer" },
          platform: {
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

describe("GET /api/invoke", () => {
  test("returns the POST body schema and success shape", async () => {
    const response = await t().fetch("/api/invoke", { method: "GET" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "POST",
      body: {
        type: "object",
        required: ["passportId", "invokeKey", "action"],
        properties: {
          passportId: { type: "string" },
          invokeKey: { type: "string" },
          action: { type: "string", enum: ["demo.echo"] },
          args: { type: "object" },
        },
      },
      success: {
        type: "object",
        required: ["echo", "passport"],
        properties: {
          echo: { type: "object" },
          passport: { type: "string" },
        },
      },
    });
  });
});

describe("OPTIONS", () => {
  test.each(["/api/credentials", "/api/invoke", "/api/platforms"])(
    "%s returns 204 with an empty body",
    async (path) => {
      const response = await t().fetch(path, { method: "OPTIONS" });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    },
  );
});

describe("POST /api/credentials denials", () => {
  test("unknown and off platforms share one code and error text", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Keyed",
      ttlMs: 60_000,
      apps: ["demo"],
    });
    const unavailable = {
      error: "This platform is not available on this passport",
      code: "platform_unavailable",
    };
    const unknown = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passportId: minted.passportId,
        invokeKey: minted.invokeKey,
        platform: "dropbox",
      }),
    });
    expect(unknown.status).toBe(403);
    expect(await unknown.json()).toEqual(unavailable);
    const off = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passportId: minted.passportId,
        invokeKey: minted.invokeKey,
        platform: "github",
      }),
    });
    expect(off.status).toBe(403);
    expect(await off.json()).toEqual(unavailable);
  });

  test("wrong invoke key is unauthorized and does not name the platform", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Keyed",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const response = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passportId: minted.passportId,
        invokeKey: "ik_wrong",
        platform: "github",
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unknown passport or invoke key",
      code: "unauthorized",
    });
  });
});

describe("GET /api/platforms", () => {
  test("wrong or missing invoke key does not leak platforms", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Secret",
      ttlMs: 60_000,
      apps: ["github", "slack"],
    });
    const wrong = await test.fetch("/api/platforms", {
      method: "GET",
      headers: {
        passportId: minted.passportId,
        invokeKey: "ik_wrong",
      },
    });
    expect(wrong.status).toBe(401);
    const wrongBody = await wrong.json();
    expect(wrongBody).toEqual({
      error: "Unknown passport or invoke key",
      code: "unauthorized",
    });
    expect(wrongBody).not.toHaveProperty("platforms");
    expect(JSON.stringify(wrongBody)).not.toMatch(/github|slack/);

    const missing = await test.fetch("/api/platforms", {
      method: "GET",
      headers: { passportId: minted.passportId },
    });
    expect(missing.status).toBe(400);
    const missingBody = await missing.json();
    expect(missingBody).toEqual({
      error: "invokeKey must be a string",
      code: "invalid_request",
    });
    expect(missingBody).not.toHaveProperty("platforms");
    expect(JSON.stringify(missingBody)).not.toMatch(/github|slack/);
  });

  test("returns on vs off for each platform and the passport expiry", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Mix",
      ttlMs: 60_000,
      apps: ["demo", "github"],
    });
    const passport = await test.query(api.passports.get, {
      passportId: minted.id,
      now: Date.now(),
    });
    expect(passport).not.toBeNull();
    const response = await test.fetch("/api/platforms", {
      method: "GET",
      headers: {
        passportId: minted.passportId,
        invokeKey: minted.invokeKey,
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      expiresAt: passport!.expiresAt,
      platforms: [
        { platform: "demo", status: "on" },
        { platform: "github", status: "on" },
        { platform: "gmail", status: "off" },
        { platform: "calendar", status: "off" },
        { platform: "drive", status: "off" },
        { platform: "docs", status: "off" },
        { platform: "sheets", status: "off" },
        { platform: "slack", status: "off" },
      ],
    });
  });
});
