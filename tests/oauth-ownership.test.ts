/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
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
      returnTo: "https://board.example/connections",
    });
    await expect(
      test.mutation(internal.tables.oauthStates.mutations.consume, {
        state: "state-1",
      }),
    ).resolves.toBeNull();
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
          accessToken: `token-${login}`,
          login,
          providerUserId: login,
        },
      );
    }

    const first = await test.query(
      internal.tables.connections.queries.getConnection,
      { userId: firstUserId, provider: "github" },
    );
    const second = await test.query(
      internal.tables.connections.queries.getConnection,
      { userId: secondUserId, provider: "github" },
    );
    expect(first?.login).toBe("first");
    expect(second?.login).toBe("second");
  });
});
