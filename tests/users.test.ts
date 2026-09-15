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

describe("users.viewer", () => {
  test("user provisioning creates one passport and is idempotent", async () => {
    const backend = t();
    const result = await backend.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Nishil Faldu",
        email: "nishil@example.com",
      });
      const first = await ensurePassport(ctx, userId);
      const second = await ensurePassport(ctx, userId);
      const passports = await ctx.db.query("passports").collect();
      return { userId, first, second, passports };
    });
    expect(result.first).toEqual(result.second);
    expect(result.passports).toHaveLength(1);
    expect(result.passports[0]).toMatchObject({
      userId: result.userId,
      name: "Default passport",
    });
  });

  test("returns null when signed out", async () => {
    const viewer = await t().query(api.users.viewer, {});
    expect(viewer).toBeNull();
  });

  test("returns the signed-in user's name, email, and avatar", async () => {
    const backend = t();
    const userId = await backend.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Nishil Faldu",
        email: "nishil@example.com",
        image: "https://example.com/avatar.png",
      });
    });
    const viewer = await backend
      .withIdentity({ subject: `${userId}|session-1` })
      .query(api.users.viewer, {});
    expect(viewer).toEqual({
      name: "Nishil Faldu",
      email: "nishil@example.com",
      avatarUrl: "https://example.com/avatar.png",
    });
  });

  test("returns null when the identity has no matching user", async () => {
    const viewer = await t()
      .withIdentity({ subject: "missing-user|session-1" })
      .query(api.users.viewer, {});
    expect(viewer).toBeNull();
  });
});
