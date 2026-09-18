/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

describe("users.viewer", () => {
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
    const backend = t();
    const missingUserId = await backend.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        name: "Gone",
        email: "gone@example.com",
      });
      await ctx.db.delete("users", id);
      return id;
    });
    const viewer = await backend
      .withIdentity({ subject: `${missingUserId}|session-1` })
      .query(api.users.viewer, {});
    expect(viewer).toBeNull();
  });
});
