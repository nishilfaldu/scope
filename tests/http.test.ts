/// <reference types="vite/client" />
import { managedRow } from "./helpers/connect";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
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
    apps: "slack"[];
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
      await ctx.db.insert(
        "connections",
        managedRow({
          userId,
          login: "nishil",
          providerUserId: `${app}-1`,
          grantVersion: 1,
        }),
      );
    }
  });
  return await test
    .withIdentity({ subject: `${userId}|session-1` })
    .mutation(internal.tables.slices.mutations.createFixture, args);
}

describe("POST /api/credentials denials", () => {
  test("unsupported apps and unbound Slack accounts share the unavailable denial", async () => {
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
    await test.run(async (ctx) => {
      const bindings = await ctx.db.query("sliceBindings").collect();
      for (const binding of bindings)
        await ctx.db.delete("sliceBindings", binding._id);
    });
    const off = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
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
      apps: ["slack"],
    });
    const response = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: "ss_wrong",
        app: "slack",
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
      apps: ["slack"],
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
});

describe("GET /api/accounts", () => {
  test("returns only allowed accounts and requires the slice secret", async () => {
    const test = t();
    const created = await createSlice(test, {
      name: "Account discovery",
      ttlMs: 60_000,
      apps: ["slack"],
    });
    await test.run(async (ctx) => {
      const slice = await ctx.db.get("slices", created.id);
      await ctx.db.insert(
        "connections",
        managedRow({
          userId: slice!.userId,
          login: "ungranted-workspace",
          providerUserId: "T2:U2",
        }),
      );
    });
    const headers = {
      "x-slice-token": created.sliceToken,
      "x-slice-secret": created.sliceSecret,
    };
    const response = await test.fetch("/api/accounts?app=slack", {
      method: "GET",
      headers,
    });
    expect(response.status).toBe(200);
    const discovered = await response.json();
    expect(discovered.accounts).toHaveLength(1);
    expect(discovered).toMatchObject({
      app: "slack",
      accounts: [
        expect.objectContaining({
          login: "nishil",
          bindingId: expect.any(String),
        }),
      ],
    });
    const other = await test.fetch("/api/accounts?app=github", {
      method: "GET",
      headers,
    });
    expect(other.status).toBe(403);
    const denied = await test.fetch("/api/accounts?app=slack", {
      method: "GET",
      headers: { ...headers, "x-slice-secret": "ss_wrong" },
    });
    expect(denied.status).toBe(401);
    expect(await denied.json()).not.toHaveProperty("accounts");
  });
});
