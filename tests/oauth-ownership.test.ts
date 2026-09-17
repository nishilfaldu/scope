/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

async function user(test: ReturnType<typeof t>, email: string) {
  return await test.run(async (ctx) =>
    ctx.db.insert("users", { name: email, email }),
  );
}

describe("OAuth ownership", () => {
  test("state keeps the account that started the flow", async () => {
    const test = t();
    const userId = await user(test, "owner@example.com");
    await test.mutation(internal.tables.oauthStates.mutations.put, {
      userId,
      provider: "github",
      app: "github",
      state: "state-1",
      returnTo: "https://board.example/connections",
    });

    await expect(
      test.mutation(internal.tables.oauthStates.mutations.consume, {
        state: "state-1",
      }),
    ).resolves.toEqual({
      userId,
      provider: "github",
      app: "github",
      returnTo: "https://board.example/connections",
    });
    await expect(
      test.mutation(internal.tables.oauthStates.mutations.consume, {
        state: "state-1",
      }),
    ).resolves.toBeNull();
  });

  test("signed-in board user creates state for the connect redirect", async () => {
    vi.stubEnv("BOARD_ORIGIN", "http://localhost:3000");
    const test = t();
    const userId = await user(test, "owner@example.com");
    const result = await test
      .withIdentity({ subject: `${userId}|session-1` })
      .mutation(api.tables.oauthStates.mutations.start, {
        app: "github",
        returnTo: "https://board.example/connections",
      });

    expect(result.state).toEqual(expect.any(String));
    await expect(
      test.mutation(internal.tables.oauthStates.mutations.consume, {
        state: result.state,
      }),
    ).resolves.toEqual({
      userId,
      provider: "github",
      app: "github",
      returnTo: "http://localhost:3000/connections",
    });
  });

  test("connect route accepts state minted by the signed-in board", async () => {
    vi.stubEnv("BOARD_ORIGIN", "http://localhost:3000");
    const test = t();
    const userId = await user(test, "owner@example.com");
    const { state } = await test
      .withIdentity({ subject: `${userId}|session-1` })
      .mutation(api.tables.oauthStates.mutations.start, {
        app: "github",
        returnTo: "http://localhost:3000/connections",
      });

    const response = await test.fetch(`/api/github/connect?state=${state}`);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("GitHub App is not configured.");
  });

  test("the same provider can be connected once per user", async () => {
    const test = t();
    const firstUserId = await user(test, "first@example.com");
    const secondUserId = await user(test, "second@example.com");
    for (const [userId, login] of [
      [firstUserId, "first"],
      [secondUserId, "second"],
    ] as const) {
      await test.mutation(
        internal.tables.connections.mutations.saveConnection,
        {
          userId,
          provider: "github",
          app: "github",
          accessToken: `token-${login}`,
          login,
          providerUserId: login,
        },
      );
    }

    const ids = await test.run(async (ctx) => await ctx.db.query("connections").withIndex("by_user_provider_app_providerUserId", (q) => q.eq("userId", firstUserId).eq("provider", "github").eq("app", "github")).collect());
    const secondIds = await test.run(async (ctx) => await ctx.db.query("connections").withIndex("by_user_provider_app_providerUserId", (q) => q.eq("userId", secondUserId).eq("provider", "github").eq("app", "github")).collect());
    const first = await test.query(
      internal.tables.connections.queries.getConnection,
      { userId: firstUserId, app: "github", connectionId: ids[0]._id },
    );
    const second = await test.query(
      internal.tables.connections.queries.getConnection,
      { userId: secondUserId, app: "github", connectionId: secondIds[0]._id },
    );
    expect(first?.login).toBe("first");
    expect(second?.login).toBe("second");
  });
});
