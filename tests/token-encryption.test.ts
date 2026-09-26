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
  return {
    backend: test.withIdentity({ subject: `${userId}|session-1` }),
    userId,
  };
}

describe("connection secrets at rest", () => {
  test("saveConnection stores ciphertext, getConnection returns plaintext", async () => {
    const test = t();
    const { userId } = await signedIn(test);
    const accessToken = "ghs_standing_token";
    const refreshToken = "ghr_refresh_token";

    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      provider: "github",
      app: "github",
      accessToken,
      login: "octocat",
      providerUserId: "1",
      refreshToken,
    });

    const stored = await test.run(async (ctx) => {
      return await ctx.db
        .query("connections")
        .withIndex("by_user_app_providerUserId", (q) =>
          q.eq("userId", userId).eq("app", "github"),
        )
        .unique();
    });
    expect(stored).not.toBeNull();
    expect(stored!.accessToken).not.toBe(accessToken);
    expect(stored!.accessToken.startsWith("enc:v1:")).toBe(true);
    expect(stored!.refreshToken).not.toBe(refreshToken);
    expect(stored!.refreshToken!.startsWith("enc:v1:")).toBe(true);

    const loaded = await test.query(
      internal.tables.connections.queries.getConnection,
      { userId, app: "github", connectionId: stored!._id },
    );
    expect(loaded).toMatchObject({
      accessToken,
      refreshToken,
      login: "octocat",
      providerUserId: "1",
    });
  });

  test("getConnection rejects plaintext-looking stored tokens", async () => {
    const test = t();
    const { userId } = await signedIn(test);

    const connectionId = await test.run(async (ctx) => {
      return await ctx.db.insert("connections", {
        userId,
        app: "github",
        accessToken: "ghs_plaintext_stored",
        login: "octocat",
        providerUserId: "1",
        refreshToken: "ghr_plaintext_stored",
        grantVersion: 1,
      });
    });

    await expect(
      test.query(internal.tables.connections.queries.getConnection, {
        userId,
        app: "github",
        connectionId,
      }),
    ).rejects.toThrow(/not encrypted/);
  });

  test("account statuses omit access and refresh tokens", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      provider: "github",
      app: "github",
      accessToken: "ghs_standing_token",
      login: "octocat",
      providerUserId: "1",
      refreshToken: "ghr_refresh_token",
    });

    const statuses = await backend.query(
      api.tables.connections.queries.statusesForApps,
      { apps: ["github"] },
    );
    const github = statuses.find(({ provider }) => provider === "github");
    expect(github).toEqual({
      provider: "github",
      app: "github",
      connected: true,
      accounts: [expect.objectContaining({ login: "octocat" })],
    });
    expect(JSON.stringify(statuses)).not.toMatch(/ghs_|ghr_|enc:v1:/);
    expect(github).not.toHaveProperty("accessToken");
    expect(github).not.toHaveProperty("refreshToken");
  });
});
