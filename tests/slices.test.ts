/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
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

  test("create refuses a second passport for the same account", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    await backend.mutation(api.tables.slices.mutations.create, {
      name: "One", ttlMs: 60_000, apps: ["github"],
    });

    await expect(
      backend.mutation(api.tables.slices.mutations.create, {
        name: "Two", ttlMs: 60_000, apps: ["slack"],
      }),
    ).rejects.toThrow(
      "This account already has a passport. Only one passport is supported right now.",
    );

    const counts = await test.run(async (ctx) => ({
      passports: (await ctx.db.query("passports").collect()).length,
      slices: (await ctx.db.query("slices").collect()).length,
      grants: (await ctx.db.query("grants").collect()).length,
    }));
    expect(counts).toEqual({ passports: 1, slices: 1, grants: 1 });
  });

  test("create refuses a signed-out caller", async () => {
    const test = t();
    await expect(
      test.mutation(api.tables.slices.mutations.create, {
        name: "Nope", ttlMs: 60_000, apps: ["github"],
      }),
    ).rejects.toThrow(/Sign in/);
  });


});
