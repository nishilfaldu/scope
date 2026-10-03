/// <reference types="vite/client" />
import { managedRow } from "./helpers/connect";
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
    await ctx.db.insert(
      "connections",
      managedRow({
        userId,
        login: "nishil",
        providerUserId: "slack-1",
        grantVersion: 1,
      }),
    );
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
      { name: "Self revoke", ttlMs: 60_000, apps: ["slack"] },
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

  test("get only returns the signed-in user's slice", async () => {
    const test = t();
    const { backend: owner } = await signedIn(test);
    const created = await owner.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Owner agent",
        ttlMs: 60_000,
        apps: ["slack"],
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
        apps: ["slack"],
      }),
    ).toMatchObject([{ app: "slack", sliceId: created.id }]);
    await expect(
      otherUser.query(api.tables.slices.queries.bindingsForApps, {
        sliceId: created.id,
        apps: ["slack"],
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
        apps: ["slack"],
      },
    );
    const { backend: otherUser } = await signedIn(test);

    await expect(
      otherUser.mutation(api.tables.slices.mutations.setBinding, {
        sliceToken: created.sliceToken,
        app: "slack",
        connectionId: (
          await owner.query(api.tables.connections.queries.statusesForApps, {
            apps: ["slack"],
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
        apps: ["slack"],
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
        app: "slack",
        connectionId: (
          await owner.query(api.tables.connections.queries.statusesForApps, {
            apps: ["slack"],
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
