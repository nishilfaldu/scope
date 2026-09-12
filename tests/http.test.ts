/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
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
  test.each(["/api/credentials", "/api/invoke"])(
    "%s returns 204 with an empty body",
    async (path) => {
      const response = await t().fetch(path, { method: "OPTIONS" });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    },
  );
});
