/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

async function signedIn(test: ReturnType<typeof t>) {
  const userId = await test.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Nishil Faldu",
      email: "nishil@example.com",
    });
  });
  return { backend: test.withIdentity({ subject: `${userId}|session-1` }), userId };
}

describe("slice ownership", () => {
  test("create binds the slice to the signed-in user's passport and grant", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "PR agent", ttlMs: 60_000, apps: ["github"],
    });
    const stored = await test.run(async (ctx) => {
      const slice = await ctx.db.get("slices", created.id);
      if (!slice) throw new Error("slice missing");
      const passport = await ctx.db.get("passports", slice.passportId);
      const grant = await ctx.db.get("grants", slice.grantId);
      return { slice, passport, grant };
    });
    expect(stored.slice.userId).toEqual(userId);
    expect(stored.passport).toMatchObject({ userId, name: "Default passport" });
    expect(stored.passport).not.toHaveProperty("token");
    expect(stored.grant).toMatchObject({
      passportId: stored.passport?._id,
      userId,
      agent: "PR agent",
      apps: ["github"],
      expiresAt: created.expiresAt,
    });
  });

  test("create reuses the same passport for a second slice", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const first = await backend.mutation(api.tables.slices.mutations.create, {
      name: "One", ttlMs: 60_000, apps: ["github"],
    });
    const second = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Two", ttlMs: 60_000, apps: ["slack"],
    });
    const passports = await test.run(async (ctx) => {
      const one = await ctx.db.get("slices", first.id);
      const two = await ctx.db.get("slices", second.id);
      return [one?.passportId, two?.passportId];
    });
    expect(passports[0]).toEqual(passports[1]);
    const count = await test.run(
      async (ctx) => (await ctx.db.query("passports").collect()).length,
    );
    expect(count).toBe(1);
  });

  test("create refuses a signed-out caller", async () => {
    const test = t();
    await expect(
      test.mutation(api.tables.slices.mutations.create, {
        name: "Nope", ttlMs: 60_000, apps: ["github"],
      }),
    ).rejects.toThrow(/Sign in/);
  });

  test("authorizing claims an unowned connection for the slice's passport", async () => {
    const test = t();
    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      provider: "github",
      accessToken: "ghs_standing_token",
      login: "octocat",
      providerUserId: "1",
    });
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "GitHub agent", ttlMs: 60_000, apps: ["github"],
    });
    const allowed = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
      passportToken: created.passportToken,
      passportSecret: created.passportSecret,
      app: "github",
      refresh: false,
    });
    expect(allowed.ok).toBe(true);
    const connection = await test.run(async (ctx) => {
      const rows = await ctx.db.query("connections").collect();
      return rows[0];
    });
    const slice = await test.run(async (ctx) => ctx.db.get("slices", created.id));
    expect(connection?.passportId).toEqual(slice?.passportId);
  });
});

describe("migrations.toSlices", () => {
  test("converts legacy passports and unowned connections, then converges", async () => {
    const test = t();
    const { userId } = await signedIn(test);
    await test.run(async (ctx) => {
      await ctx.db.insert("passports", {
        name: "Legacy agent",
        token: "pp_legacy",
        passportSecretHash: "deadbeef",
        status: "active",
        expiresAt: Date.now() + 60_000,
        apps: ["github"],
      });
      await ctx.db.insert("connections", {
        provider: "github",
        accessToken: "ghs_standing_token",
        login: "octocat",
        providerUserId: "1",
      });
    });

    const first = await test.mutation(internal.migrations.toSlices, {});
    expect(first).toEqual({
      passportsCreated: 1,
      connectionsLinked: 1,
      slicesCreated: 1,
    });

    const state = await test.run(async (ctx) => {
      const passports = await ctx.db.query("passports").collect();
      const slices = await ctx.db.query("slices").collect();
      const grants = await ctx.db.query("grants").collect();
      const connections = await ctx.db.query("connections").collect();
      return { passports, slices, grants, connections };
    });
    expect(state.passports).toHaveLength(1);
    expect(state.passports[0]).toMatchObject({ userId, name: "Default passport" });
    expect(state.slices).toHaveLength(1);
    expect(state.slices[0]).toMatchObject({
      passportId: state.passports[0]._id,
      userId,
      name: "Legacy agent",
      token: "pp_legacy",
      secretHash: "deadbeef",
      status: "active",
      apps: ["github"],
    });
    expect(state.grants).toHaveLength(1);
    expect(state.grants[0]._id).toEqual(state.slices[0].grantId);
    expect(state.connections[0].passportId).toEqual(state.passports[0]._id);

    const second = await test.mutation(internal.migrations.toSlices, {});
    expect(second).toEqual({
      passportsCreated: 0,
      connectionsLinked: 0,
      slicesCreated: 0,
    });
  });

  test("creates an unowned passport when no user exists yet", async () => {
    const test = t();
    const result = await test.mutation(internal.migrations.toSlices, {});
    expect(result).toEqual({
      passportsCreated: 1,
      connectionsLinked: 0,
      slicesCreated: 0,
    });
    const passports = await test.run(
      async (ctx) => await ctx.db.query("passports").collect(),
    );
    expect(passports).toHaveLength(1);
    expect(passports[0].userId).toBeUndefined();
  });
});
