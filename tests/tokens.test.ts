/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

async function signedIn(test: ReturnType<typeof t>, connect = true) {
  const userId = await test.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Nishil Faldu",
      email: "nishil@example.com",
    });
  });
  if (connect) {
    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      provider: "github",
      app: "github",
      accessToken: "ghs_standing_token",
      login: "octocat",
      providerUserId: "1",
    });
  }
  return {
    backend: test.withIdentity({ subject: `${userId}|session-1` }),
    userId,
  };
}

async function seedGithub(
  test: ReturnType<typeof t>,
  userId: Awaited<ReturnType<typeof signedIn>>["userId"],
) {
  await test.mutation(internal.tables.connections.mutations.saveConnection, {
    userId,
    provider: "github",
    app: "github",
    accessToken: "ghs_standing_token",
    login: "octocat",
    providerUserId: "1",
  });
}

describe("accounts and slices", () => {
  test("create returns credentials without exposing the secret hash", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    for (const provider of ["google", "slack"] as const) {
      await test.mutation(
        internal.tables.connections.mutations.saveConnection,
        {
          userId,
          provider,
          app: provider === "google" ? "gmail" : provider,
          accessToken: `${provider}-token`,
          login: "nishil",
          providerUserId: `${provider}-1`,
        },
      );
    }
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "PR agent",
      ttlMs: 60_000,
      apps: ["github", "gmail", "slack"],
    });
    expect(created.sliceToken.startsWith("st_")).toBe(true);
    expect(created.sliceSecret.startsWith("ss_")).toBe(true);
    const listed = await backend.query(api.tables.slices.queries.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(listed.page).toHaveLength(1);
    expect(listed.page[0]).not.toHaveProperty("sliceSecret");
  });

  test("create validates its name and TTL", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    await expect(
      backend.mutation(api.tables.slices.mutations.create, {
        name: "   ",
        ttlMs: 60_000,
        apps: ["github"],
      }),
    ).rejects.toThrow(/Name must be 1 to 80 characters/);
    await expect(
      backend.mutation(api.tables.slices.mutations.create, {
        name: "n".repeat(81),
        ttlMs: 60_000,
        apps: ["github"],
      }),
    ).rejects.toThrow(/80 characters/);
    await expect(
      backend.mutation(api.tables.slices.mutations.create, {
        name: "Long",
        ttlMs: 8 * 24 * 60 * 60 * 1000,
        apps: ["github"],
      }),
    ).rejects.toThrow(/7 days/);
  });

  test("setBinding updates indexed slice bindings", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    for (const provider of ["google", "slack"] as const) {
      await test.mutation(
        internal.tables.connections.mutations.saveConnection,
        {
          userId,
          provider,
          app: provider === "google" ? "gmail" : provider,
          accessToken: `${provider}-token`,
          login: "nishil",
          providerUserId: `${provider}-1`,
        },
      );
    }
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Multi",
      ttlMs: 60_000,
      apps: ["github", "gmail", "slack"],
    });
    const gmailId = (
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["gmail"],
      })
    )[0].accounts[0].id;
    await backend.mutation(api.tables.slices.mutations.setBinding, {
      sliceToken: created.sliceToken,
      app: "gmail",
      connectionId: gmailId,
      enabled: false,
    });
    const slice = await backend.query(api.tables.slices.queries.get, {
      sliceId: created.id,
    });
    const bindings = await test.run(async (ctx) =>
      ctx.db
        .query("sliceBindings")
        .withIndex("by_slice_app_connectionId", (q) =>
          q.eq("sliceId", created.id),
        )
        .collect(),
    );
    expect(bindings.map((binding) => binding.app).sort()).toEqual([
      "github",
      "slack",
    ]);
    expect(slice).not.toHaveProperty("grantApps");
  });

  test("disconnecting an account leaves slices intact", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    await seedGithub(test, userId);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Keep me",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const githubId = (
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["github"],
      })
    ).find((row) => row.app === "github")!.accounts[0].id;
    await backend.action(api.tables.connections.actions.disconnect, {
      app: "github",
      connectionId: githubId,
    });
    const slice = await backend.query(api.tables.slices.queries.get, {
      sliceId: created.id,
    });
    expect(slice?.name).toBe("Keep me");
  });

  test("connection status and disconnect are scoped to the signed-in user", async () => {
    const test = t();
    const { backend: owner, userId: ownerId } = await signedIn(test);
    const { backend: other } = await signedIn(test, false);
    await seedGithub(test, ownerId);

    const ownerStatuses = await owner.query(
      api.tables.connections.queries.statusesForApps,
      { apps: ["github"] },
    );
    const otherStatuses = await other.query(
      api.tables.connections.queries.statusesForApps,
      { apps: ["github"] },
    );
    expect(
      ownerStatuses.find(({ provider }) => provider === "github"),
    ).toMatchObject({
      connected: true,
      accounts: [expect.objectContaining({ login: "octocat" })],
    });
    expect(
      otherStatuses.find(({ provider }) => provider === "github"),
    ).toMatchObject({
      connected: false,
      accounts: [],
    });

    await other.action(api.tables.connections.actions.disconnect, {
      app: "github",
      connectionId: ownerStatuses.find((row) => row.app === "github")!
        .accounts[0].id,
    });
    const stillConnected = await owner.query(
      api.tables.connections.queries.statusesForApps,
      { apps: ["github"] },
    );
    expect(
      stillConnected.find(({ provider }) => provider === "github")?.connected,
    ).toBe(true);
  });
});

describe("credential authorization", () => {
  test("an enabled connected app is authorized without leaking the standing token", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    await seedGithub(test, userId);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "GitHub agent",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const allowed = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      },
    );
    expect(allowed).toMatchObject({
      ok: true,
      sliceId: created.id,
      app: "github",
      provider: "github",
    });
    if (!allowed.ok) throw new Error("expected authorization");
    const finalized = await test.mutation(
      internal.tables.slices.credentials.finalize,
      {
        sliceId: allowed.sliceId,
        app: allowed.app,
        bindingId: allowed.bindingId,
        connectionId: allowed.connectionId,
      },
    );
    expect(finalized).toEqual({ ok: true });
    expect(JSON.stringify(allowed)).not.toMatch(/ghs_/);
    expect(JSON.stringify(finalized)).not.toMatch(/ghs_/);
  });

  test("removing a binding immediately denies a live slice", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    await seedGithub(test, userId);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "GitHub agent",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const githubId = (
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["github"],
      })
    )[0].accounts[0].id;
    await backend.mutation(api.tables.slices.mutations.setBinding, {
      sliceToken: created.sliceToken,
      app: "github",
      connectionId: githubId,
      enabled: false,
    });
    const denied = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      },
    );
    expect(denied).toMatchObject({
      ok: false,
      status: 403,
      code: "APP_UNAVAILABLE",
    });
  });

  test("revoked and expired slices are denied", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    await seedGithub(test, userId);
    const revokedSlice = await backend.mutation(
      api.tables.slices.mutations.create,
      {
        name: "Revoked",
        ttlMs: 60_000,
        apps: ["github"],
      },
    );
    await backend.mutation(api.tables.slices.mutations.revoke, {
      sliceToken: revokedSlice.sliceToken,
    });
    const revoked = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: revokedSlice.sliceToken,
        sliceSecret: revokedSlice.sliceSecret,
        app: "github",
      },
    );
    expect(revoked).toMatchObject({ ok: false, code: "REVOKED" });

    const { backend: secondAccount } = await signedIn(test);
    const expiredSlice = await secondAccount.mutation(
      api.tables.slices.mutations.create,
      {
        name: "Expired",
        ttlMs: 60_000,
        apps: ["github"],
      },
    );
    await test.run(async (ctx) => {
      await ctx.db.patch("slices", expiredSlice.id, {
        expiresAt: Date.now() - 1_000,
      });
    });
    const expired = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: expiredSlice.sliceToken,
        sliceSecret: expiredSlice.sliceSecret,
        app: "github",
      },
    );
    expect(expired).toMatchObject({ ok: false, code: "EXPIRED" });
  });

  test("unknown and unconnected apps share the unavailable denial", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "GitHub only",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const githubId = (
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["github"],
      })
    ).find((row) => row.app === "github")!.accounts[0].id;
    await backend.action(api.tables.connections.actions.disconnect, {
      app: "github",
      connectionId: githubId,
    });
    const unavailable = {
      ok: false,
      status: 403,
      reason: "This app is not available to this slice",
      code: "APP_UNAVAILABLE",
    };
    const unknown = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "dropbox",
      },
    );
    expect(unknown).toMatchObject(unavailable);
    const unconnected = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      },
    );
    expect(unconnected).toMatchObject(unavailable);
  });

  test("an invalid slice secret is refused", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    await seedGithub(test, userId);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Keyed",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const denied = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: "ss_wrong",
        app: "github",
      },
    );
    expect(denied).toMatchObject({
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  test("a Gmail connection does not grant other Google apps", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      userId,
      provider: "google",
      app: "gmail",
      accessToken: "ya29.standing",
      login: "user@gmail.com",
      providerUserId: "sub",
    });
    const statuses = await backend.query(
      api.tables.connections.queries.statusesForApps,
      { apps: ["gmail", "calendar", "drive", "docs", "sheets"] },
    );
    expect(statuses.find((row) => row.app === "gmail")?.connected).toBe(true);
    for (const app of ["calendar", "drive", "docs", "sheets"] as const) {
      expect(statuses.find((row) => row.app === app)?.connected).toBe(false);
    }
    await expect(
      backend.mutation(api.tables.slices.mutations.create, {
        name: "Workspace",
        ttlMs: 60_000,
        apps: ["gmail", "calendar"],
      }),
    ).rejects.toThrow("Select at least one account for every requested app");
  });
});
