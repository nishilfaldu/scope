/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
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
  test("create returns credentials without exposing the key hash", async () => {
    const test = t();
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "PR agent",
      ttlMs: 60_000,
      apps: ["github", "gmail", "slack"],
    });
    expect(created.passportId.startsWith("pp_")).toBe(true);
    expect(created.invokeKey.startsWith("ik_")).toBe(true);
    const listed = await test.query(api.tables.passports.queries.list, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("invokeKey");
    expect(listed[0]).not.toHaveProperty("invokeKeyHash");
  });

  test("create validates its name and TTL", async () => {
    const test = t();
    await expect(
      test.mutation(api.tables.passports.mutations.create, {
        name: "   ", ttlMs: 60_000, apps: ["github"],
      }),
    ).rejects.toThrow(/Name must be non-empty/);
    await expect(
      test.mutation(api.tables.passports.mutations.create, {
        name: "n".repeat(81), ttlMs: 60_000, apps: ["github"],
      }),
    ).rejects.toThrow(/80 characters/);
    await expect(
      test.mutation(api.tables.passports.mutations.create, {
        name: "Long", ttlMs: 8 * 24 * 60 * 60 * 1000, apps: ["github"],
      }),
    ).rejects.toThrow(/7 days/);
  });

  test("setPlatform updates only the selected platform and records it", async () => {
    const test = t();
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "Multi", ttlMs: 60_000, apps: ["github", "gmail", "slack"],
    });
    await test.mutation(api.tables.passports.mutations.setPlatform, {
      passportId: created.passportId, platform: "gmail", enabled: false,
    });
    const passport = await test.query(api.tables.passports.queries.get, {
      passportId: created.id,
    });
    expect(passport?.apps.sort()).toEqual(["github", "slack"]);
    const toggled = await test.query(api.tables.auditEvents.queries.listHistory, {
      passportId: created.id,
      kind: "platform_toggled",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(toggled.page).toHaveLength(1);
    expect(toggled.page[0]?.reason).toBe("Disabled gmail");
  });

  test("disconnecting an account leaves passports and logs intact", async () => {
    const test = t();
    await seedGithub(test);
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "Keep me", ttlMs: 60_000, apps: ["github"],
    });
    await test.action(api.tables.connections.actions.disconnect, { provider: "github" });
    const passport = await test.query(api.tables.passports.queries.get, {
      passportId: created.id,
    });
    expect(passport?.name).toBe("Keep me");
    const history = await test.query(api.tables.auditEvents.queries.listHistory, {
      passportId: created.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page[0]?.kind).toBe("issued");
  });
});

describe("credential authorization", () => {
  test("an enabled connected platform is authorized and issuance is audited without its secret", async () => {
    const test = t();
    await seedGithub(test);
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "GitHub agent", ttlMs: 60_000, apps: ["github"],
    });
    const allowed = await test.mutation(internal.tables.passports.credentials.authorizeCreate, {
      passportToken: created.passportId,
      invokeKey: created.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(allowed).toMatchObject({
      ok: true, passportId: created.id, platform: "github", provider: "github",
    });
    if (!allowed.ok) throw new Error("expected authorization");
    const committed = await test.mutation(internal.tables.passports.credentials.commitCreate, {
      passportId: allowed.passportId,
      platform: allowed.platform,
      expiresAt: Date.now() + 60_000,
      refresh: false,
    });
    expect(committed.expiresAt).toBeGreaterThan(Date.now());
    const history = await test.query(api.tables.auditEvents.queries.listHistory, {
      passportId: created.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page.map((row) => row.kind)).toEqual(["token_issued", "issued"]);
    expect(JSON.stringify(history.page)).not.toMatch(/ghs_/);
  });

  test("a disabled platform is denied server-side", async () => {
    const test = t();
    await seedGithub(test);
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "GitHub agent", ttlMs: 60_000, apps: ["github"],
    });
    await test.mutation(api.tables.passports.mutations.setPlatform, {
      passportId: created.passportId, platform: "github", enabled: false,
    });
    const denied = await test.mutation(internal.tables.passports.credentials.authorizeCreate, {
      passportToken: created.passportId,
      invokeKey: created.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(denied).toMatchObject({
      ok: false, status: 403, code: "PLATFORM_UNAVAILABLE",
    });
  });

  test("revoked and expired passports are denied", async () => {
    const test = t();
    await seedGithub(test);
    const revokedPassport = await test.mutation(api.tables.passports.mutations.create, {
      name: "Revoked", ttlMs: 60_000, apps: ["github"],
    });
    await test.mutation(api.tables.passports.mutations.revoke, {
      passportId: revokedPassport.passportId,
    });
    const revoked = await test.mutation(internal.tables.passports.credentials.authorizeCreate, {
      passportToken: revokedPassport.passportId,
      invokeKey: revokedPassport.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(revoked).toMatchObject({ ok: false, code: "REVOKED" });

    const expiredPassport = await test.mutation(api.tables.passports.mutations.create, {
      name: "Expired", ttlMs: 60_000, apps: ["github"],
    });
    await test.run(async (ctx) => {
      await ctx.db.patch("passports", expiredPassport.id, {
        expiresAt: Date.now() - 1_000,
      });
    });
    const expired = await test.mutation(internal.tables.passports.credentials.authorizeCreate, {
      passportToken: expiredPassport.passportId,
      invokeKey: expiredPassport.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(expired).toMatchObject({ ok: false, code: "EXPIRED" });
  });

  test("unknown and unconnected platforms share the unavailable denial", async () => {
    const test = t();
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "GitHub only", ttlMs: 60_000, apps: ["github"],
    });
    const unavailable = {
      ok: false,
      status: 403,
      reason: "This platform is not available on this passport",
      code: "PLATFORM_UNAVAILABLE",
    };
    const unknown = await test.mutation(internal.tables.passports.credentials.authorizeCreate, {
      passportToken: created.passportId,
      invokeKey: created.invokeKey,
      platform: "dropbox",
      refresh: false,
    });
    expect(unknown).toMatchObject(unavailable);
    const unconnected = await test.mutation(internal.tables.passports.credentials.authorizeCreate, {
      passportToken: created.passportId,
      invokeKey: created.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(unconnected).toMatchObject(unavailable);
  });

  test("an invalid invoke key is refused", async () => {
    const test = t();
    await seedGithub(test);
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "Keyed", ttlMs: 60_000, apps: ["github"],
    });
    const denied = await test.mutation(internal.tables.passports.credentials.authorizeCreate, {
      passportToken: created.passportId,
      invokeKey: "ik_wrong",
      platform: "github",
      refresh: false,
    });
    expect(denied).toMatchObject({ ok: false, status: 401, code: "UNAUTHORIZED" });
  });

  test("one Google connection covers every Google platform", async () => {
    const test = t();
    await test.mutation(internal.tables.connections.mutations.saveConnection, {
      provider: "google",
      accessToken: "ya29.standing",
      login: "user@gmail.com",
      providerUserId: "sub",
    });
    const platforms = ["gmail", "calendar", "drive", "docs", "sheets"] as const;
    const created = await test.mutation(api.tables.passports.mutations.create, {
      name: "Workspace", ttlMs: 60_000, apps: [...platforms],
    });
    for (const platform of platforms) {
      const allowed = await test.mutation(internal.tables.passports.credentials.authorizeCreate, {
        passportToken: created.passportId,
        invokeKey: created.invokeKey,
        platform,
        refresh: false,
      });
      expect(allowed).toMatchObject({ ok: true, provider: "google", platform });
    }
  });
});
