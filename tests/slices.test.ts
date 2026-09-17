/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { ensurePassport } from "../convex/tables/passports";

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
  await test.run(async (ctx) => {
    await ensurePassport(ctx, userId);
  });
  await test.run(async (ctx) => {
    await ctx.db.insert("connections", {
      userId,
      provider: "github",
      app: "github",
      accessToken: "github-token",
      login: "nishil",
      providerUserId: "github-1",
    });
  });
  await test.run(async (ctx) => {
    await ctx.db.insert("connections", {
      userId,
      provider: "google",
      app: "gmail",
      accessToken: "google-token",
      login: "nishil@example.com",
      providerUserId: "google-1",
    });
  });
  return {
    backend: test.withIdentity({ subject: `${userId}|session-1` }),
    userId,
  };
}

describe("slice ownership", () => {
  test("create binds the slice to the signed-in user's passport and grant", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "PR agent",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const stored = await test.run(async (ctx) => {
      const slice = await ctx.db.get("slices", created.id);
      if (!slice) throw new Error("slice missing");
      const passport = await ctx.db.get("passports", slice.passportId);
      const grant = await ctx.db.get("grants", slice.grantId);
      return { slice, passport, grant };
    });
    expect(stored.slice.userId).toEqual(userId);
    expect(stored.slice).not.toHaveProperty("apps");
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

  test("create requires a connection and only accepts connected apps", async () => {
    const test = t();
    const userId = await test.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "No connections",
        email: "none@example.com",
      }),
    );
    await test.run(async (ctx) => {
      await ensurePassport(ctx, userId);
    });
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    await expect(
      backend.mutation(api.tables.slices.mutations.create, {
        name: "Blocked",
        ttlMs: 60_000,
        apps: ["github"],
      }),
    ).rejects.toThrow("Select one account for each app");
    await test.run(async (ctx) => {
      await ctx.db.insert("connections", {
        userId,
        provider: "github",
        app: "github",
        accessToken: "github-token",
        login: "nishil",
        providerUserId: "github-1",
      });
    });
    await expect(
      backend.mutation(api.tables.slices.mutations.create, {
        name: "Blocked",
        ttlMs: 60_000,
        apps: ["slack"],
      }),
    ).rejects.toThrow("Select one account for each app");
  });

  test("create reuses the existing passport for later slices", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const first = await backend.mutation(api.tables.slices.mutations.create, {
      name: "One",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const second = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Two",
      ttlMs: 60_000,
      apps: ["github"],
    });

    const stored = await test.run(async (ctx) => ({
      passports: await ctx.db.query("passports").collect(),
      slices: await ctx.db.query("slices").collect(),
      grants: await ctx.db.query("grants").collect(),
    }));
    expect(stored.passports).toHaveLength(1);
    expect(stored.slices).toHaveLength(2);
    expect(stored.grants).toHaveLength(2);
    expect(first.id).not.toEqual(second.id);
    expect(stored.slices.map((slice) => slice.passportId)).toEqual([
      stored.passports[0]?._id,
      stored.passports[0]?._id,
    ]);
    expect(stored.grants.map((grant) => grant.passportId)).toEqual([
      stored.passports[0]?._id,
      stored.passports[0]?._id,
    ]);
  });

  test("create refuses a signed-out caller", async () => {
    const test = t();
    await expect(
      test.mutation(api.tables.slices.mutations.create, {
        name: "Nope",
        ttlMs: 60_000,
        apps: ["github"],
      }),
    ).rejects.toThrow(/Sign in/);
  });

  test("list and get only return the signed-in user's slices", async () => {
    const test = t();
    const { backend: owner } = await signedIn(test);
    const created = await owner.mutation(api.tables.slices.mutations.create, {
      name: "Owner agent",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const { backend: otherUser } = await signedIn(test);

    const ownerList = await owner.query(api.tables.slices.queries.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    const otherList = await otherUser.query(api.tables.slices.queries.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(ownerList.page).toHaveLength(1);
    expect(otherList.page).toHaveLength(0);
    expect(
      await otherUser.query(api.tables.slices.queries.get, {
        sliceId: created.id,
      }),
    ).toBeNull();
  });

  test("another user cannot change or revoke a slice", async () => {
    const test = t();
    const { backend: owner } = await signedIn(test);
    const created = await owner.mutation(api.tables.slices.mutations.create, {
      name: "Owner agent",
      ttlMs: 60_000,
      apps: ["github", "gmail"],
    });
    const { backend: otherUser } = await signedIn(test);

    await expect(
      otherUser.mutation(api.tables.slices.mutations.setApp, {
        sliceToken: created.sliceToken,
        app: "gmail",
        enabled: false,
      }),
    ).rejects.toThrow("Slice not found");
    await expect(
      otherUser.mutation(api.tables.slices.mutations.revoke, {
        sliceToken: created.sliceToken,
      }),
    ).rejects.toThrow("Slice not found");

    const slice = await owner.query(api.tables.slices.queries.get, {
      sliceId: created.id,
    });
    expect(slice).toMatchObject({
      status: "active",
      grantApps: ["github", "gmail"],
    });
  });

  test("signed-out callers cannot read or mutate slices", async () => {
    const test = t();
    const { backend: owner } = await signedIn(test);
    const created = await owner.mutation(api.tables.slices.mutations.create, {
      name: "Owner agent",
      ttlMs: 60_000,
      apps: ["github"],
    });

    await expect(
      test.query(api.tables.slices.queries.list, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("Sign in to continue");
    await expect(
      test.query(api.tables.slices.queries.get, {
        sliceId: created.id,
      }),
    ).rejects.toThrow("Sign in to continue");
    await expect(
      test.mutation(api.tables.slices.mutations.setApp, {
        sliceToken: created.sliceToken,
        app: "github",
        enabled: false,
      }),
    ).rejects.toThrow("Sign in to continue");
    await expect(
      test.mutation(api.tables.slices.mutations.revoke, {
        sliceToken: created.sliceToken,
      }),
    ).rejects.toThrow("Sign in to continue");
  });
});
