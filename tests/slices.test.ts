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
  await test.run(async (ctx) => {
    await ctx.db.insert("connections", {
      userId,
      app: "github",
      accessToken: "github-token",
      login: "nishil",
      providerUserId: "github-1",
    });
  });
  await test.run(async (ctx) => {
    await ctx.db.insert("connections", {
      userId,
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
  test("an agent can revoke its own slice with its private credentials", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      { name: "Self revoke", ttlMs: 60_000, apps: ["github"] },
    );
    const response = await test.fetch("/api/slices/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "revoked" });
    expect(
      (await test.run((ctx) => ctx.db.get("slices", created.id)))?.status,
    ).toBe("revoked");
  });

  test("create binds the slice to the signed-in user's Scope account and grant", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "PR agent",
        ttlMs: 60_000,
        apps: ["github"],
      },
    );
    const stored = await test.run(async (ctx) => ({
      slice: await ctx.db.get("slices", created.id),
      bindings: await ctx.db
        .query("sliceBindings")
        .withIndex("by_slice_app_connectionId", (q) =>
          q.eq("sliceId", created.id),
        )
        .collect(),
    }));
    expect(stored.slice?.userId).toEqual(userId);
    expect(stored.slice).not.toHaveProperty("apps");
    expect(stored.bindings).toMatchObject([{ app: "github" }]);
  });

  test("create requires a connection and only accepts connected apps", async () => {
    const test = t();
    const userId = await test.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "No connections",
        email: "none@example.com",
      }),
    );
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    await expect(
      backend.mutation(internal.tables.slices.mutations.createFixture, {
        name: "Blocked",
        ttlMs: 60_000,
        apps: ["github"],
      }),
    ).rejects.toThrow("Select at least one account");
    await test.run(async (ctx) => {
      await ctx.db.insert("connections", {
        userId,
        app: "github",
        accessToken: "github-token",
        login: "nishil",
        providerUserId: "github-1",
      });
    });
    await expect(
      backend.mutation(internal.tables.slices.mutations.createFixture, {
        name: "Blocked",
        ttlMs: 60_000,
        apps: ["slack"],
      }),
    ).rejects.toThrow("Select at least one account");
  });

  test("each slice owns indexed bindings", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const first = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "One",
        ttlMs: 60_000,
        apps: ["github"],
      },
    );
    const second = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Two",
        ttlMs: 60_000,
        apps: ["github"],
      },
    );
    const rows = await test.run(async (ctx) =>
      ctx.db.query("sliceBindings").collect(),
    );
    expect(first.id).not.toEqual(second.id);
    expect(rows.map((row) => row.sliceId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  test("create refuses a signed-out caller", async () => {
    const test = t();
    await expect(
      test.mutation(internal.tables.slices.mutations.createFixture, {
        name: "Nope",
        ttlMs: 60_000,
        apps: ["github"],
      }),
    ).rejects.toThrow(/Sign in/);
  });

  test("get only returns the signed-in user's slice", async () => {
    const test = t();
    const { backend: owner } = await signedIn(test);
    const created = await owner.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Owner agent",
        ttlMs: 60_000,
        apps: ["github"],
      },
    );
    const { backend: otherUser } = await signedIn(test);

    expect(
      await owner.query(api.tables.slices.queries.get, {
        sliceId: created.id,
      }),
    ).toMatchObject({ _id: created.id });
    expect(
      await otherUser.query(api.tables.slices.queries.get, {
        sliceId: created.id,
      }),
    ).toBeNull();
    expect(
      await owner.query(api.tables.slices.queries.bindingsForApps, {
        sliceId: created.id,
        apps: ["github"],
      }),
    ).toMatchObject([{ app: "github", sliceId: created.id }]);
    await expect(
      otherUser.query(api.tables.slices.queries.bindingsForApps, {
        sliceId: created.id,
        apps: ["github"],
      }),
    ).rejects.toThrow("Slice not found");
  });

  test("another user cannot change or revoke a slice", async () => {
    const test = t();
    const { backend: owner } = await signedIn(test);
    const created = await owner.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Owner agent",
        ttlMs: 60_000,
        apps: ["github", "gmail"],
      },
    );
    const { backend: otherUser } = await signedIn(test);

    await expect(
      otherUser.mutation(api.tables.slices.mutations.setBinding, {
        sliceToken: created.sliceToken,
        app: "gmail",
        connectionId: (
          await owner.query(api.tables.connections.queries.statusesForApps, {
            apps: ["gmail"],
          })
        )[0].accounts[0].id,
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
    });
  });

  test("signed-out callers cannot read or mutate slices", async () => {
    const test = t();
    const { backend: owner } = await signedIn(test);
    const created = await owner.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Owner agent",
        ttlMs: 60_000,
        apps: ["github"],
      },
    );

    await expect(
      test.query(api.tables.slices.queries.get, {
        sliceId: created.id,
      }),
    ).rejects.toThrow("Sign in to continue");
    await expect(
      test.mutation(api.tables.slices.mutations.setBinding, {
        sliceToken: created.sliceToken,
        app: "github",
        connectionId: (
          await owner.query(api.tables.connections.queries.statusesForApps, {
            apps: ["github"],
          })
        )[0].accounts[0].id,
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
