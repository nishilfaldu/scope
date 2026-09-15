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
  return { backend: test.withIdentity({ subject: `${userId}|session-1` }), userId };
}

async function seedGithub(test: ReturnType<typeof t>) {
  await test.mutation(internal.tables.connections.mutations.saveConnection, {
    provider: "github",
    accessToken: "ghs_standing_token",
    login: "octocat",
    providerUserId: "1",
  });
}

describe("accounts and passports", () => {
  test("create returns credentials without exposing the secret hash", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "PR agent",
      ttlMs: 60_000,
      apps: ["github", "gmail", "slack"],
    });
    expect(created.passportToken.startsWith("pp_")).toBe(true);
    expect(created.passportSecret.startsWith("ps_")).toBe(true);
    const listed = await test.query(api.tables.slices.queries.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(listed.page).toHaveLength(1);
    expect(listed.page[0]).not.toHaveProperty("passportSecret");
  });

  test("create validates its name and TTL", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    await expect(
      backend.mutation(api.tables.slices.mutations.create, {
        name: "   ", ttlMs: 60_000, apps: ["github"],
      }),
    ).rejects.toThrow(/Name must be non-empty/);
    await expect(
      backend.mutation(api.tables.slices.mutations.create, {
        name: "n".repeat(81), ttlMs: 60_000, apps: ["github"],
      }),
    ).rejects.toThrow(/80 characters/);
    await expect(
      backend.mutation(api.tables.slices.mutations.create, {
        name: "Long", ttlMs: 8 * 24 * 60 * 60 * 1000, apps: ["github"],
      }),
    ).rejects.toThrow(/7 days/);
  });

  test("setApp updates only the selected app", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Multi", ttlMs: 60_000, apps: ["github", "gmail", "slack"],
    });
    await test.mutation(api.tables.slices.mutations.setApp, {
      passportToken: created.passportToken, app: "gmail", enabled: false,
    });
    const slice = await test.query(api.tables.slices.queries.get, {
      sliceId: created.id,
    });
    expect(slice?.apps.sort()).toEqual(["github", "slack"]);
  });

  test("disconnecting an account leaves passports intact", async () => {
    const test = t();
    await seedGithub(test);
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Keep me", ttlMs: 60_000, apps: ["github"],
    });
    await test.action(api.tables.connections.actions.disconnect, { provider: "github" });
    const slice = await test.query(api.tables.slices.queries.get, {
      sliceId: created.id,
    });
    expect(slice?.name).toBe("Keep me");
  });
});

describe("credential authorization", () => {
  test("an enabled connected app is authorized without leaking the standing token", async () => {
    const test = t();
    await seedGithub(test);
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "GitHub agent", ttlMs: 60_000, apps: ["github"],
    });
    const allowed = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
      passportToken: created.passportToken,
      passportSecret: created.passportSecret,
      app: "github",
      refresh: false,
    });
    expect(allowed).toMatchObject({
      ok: true, sliceId: created.id, app: "github", provider: "github",
    });
    if (!allowed.ok) throw new Error("expected authorization");
    const committed = await test.mutation(internal.tables.slices.credentials.commitCreate, {
      sliceId: allowed.sliceId,
      app: allowed.app,
      expiresAt: Date.now() + 60_000,
      refresh: false,
    });
    expect(committed.expiresAt).toBeGreaterThan(Date.now());
    expect(JSON.stringify(allowed)).not.toMatch(/ghs_/);
    expect(JSON.stringify(committed)).not.toMatch(/ghs_/);
  });

  test("a disabled app is denied server-side", async () => {
    const test = t();
    await seedGithub(test);
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "GitHub agent", ttlMs: 60_000, apps: ["github"],
    });
    await test.mutation(api.tables.slices.mutations.setApp, {
      passportToken: created.passportToken, app: "github", enabled: false,
    });
    const denied = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
      passportToken: created.passportToken,
      passportSecret: created.passportSecret,
      app: "github",
      refresh: false,
    });
    expect(denied).toMatchObject({
      ok: false, status: 403, code: "APP_UNAVAILABLE",
    });
  });

  test("revoked and expired passports are denied", async () => {
    const test = t();
    await seedGithub(test);
    const { backend } = await signedIn(test);
    const revokedPassport = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Revoked", ttlMs: 60_000, apps: ["github"],
    });
    await test.mutation(api.tables.slices.mutations.revoke, {
      passportToken: revokedPassport.passportToken,
    });
    const revoked = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
      passportToken: revokedPassport.passportToken,
      passportSecret: revokedPassport.passportSecret,
      app: "github",
      refresh: false,
    });
    expect(revoked).toMatchObject({ ok: false, code: "REVOKED" });

    const expiredPassport = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Expired", ttlMs: 60_000, apps: ["github"],
    });
    await test.run(async (ctx) => {
      await ctx.db.patch("slices", expiredPassport.id, {
        expiresAt: Date.now() - 1_000,
      });
    });
    const expired = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
      passportToken: expiredPassport.passportToken,
      passportSecret: expiredPassport.passportSecret,
      app: "github",
      refresh: false,
    });
    expect(expired).toMatchObject({ ok: false, code: "EXPIRED" });
  });

  test("unknown and unconnected apps share the unavailable denial", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "GitHub only", ttlMs: 60_000, apps: ["github"],
    });
    const unavailable = {
      ok: false,
      status: 403,
      reason: "This app is not available on this passport",
      code: "APP_UNAVAILABLE",
    };
    const unknown = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
      passportToken: created.passportToken,
      passportSecret: created.passportSecret,
      app: "dropbox",
      refresh: false,
    });
    expect(unknown).toMatchObject(unavailable);
    const unconnected = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
      passportToken: created.passportToken,
      passportSecret: created.passportSecret,
      app: "github",
      refresh: false,
    });
    expect(unconnected).toMatchObject(unavailable);
  });

  test("an invalid passport secret is refused", async () => {
    const test = t();
    await seedGithub(test);
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Keyed", ttlMs: 60_000, apps: ["github"],
    });
    const denied = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
      passportToken: created.passportToken,
      passportSecret: "ps_wrong",
      app: "github",
      refresh: false,
    });
    expect(denied).toMatchObject({ ok: false, status: 401, code: "UNAUTHORIZED" });
  });

  test("one Google connection covers every Google app", async () => {
    const test = t();
    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      provider: "google",
      accessToken: "ya29.standing",
      login: "user@gmail.com",
      providerUserId: "sub",
    });
    const apps = ["gmail", "calendar", "drive", "docs", "sheets"] as const;
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Workspace", ttlMs: 60_000, apps: [...apps],
    });
    for (const app of apps) {
      const allowed = await test.mutation(internal.tables.slices.credentials.authorizeCreate, {
        passportToken: created.passportToken,
        passportSecret: created.passportSecret,
        app,
        refresh: false,
      });
      expect(allowed).toMatchObject({ ok: true, provider: "google", app });
    }
  });
});
