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
  await test.mutation(internal.connections.saveConnection, {
    provider: "github",
    accessToken: "ghs_standing_token",
    login: "octocat",
    providerUserId: "1",
  });
}

async function seedSlack(test: ReturnType<typeof t>) {
  await test.mutation(internal.connections.saveConnection, {
    provider: "slack",
    accessToken: "xoxp-standing-token",
    login: "nishil",
    providerUserId: "U1",
  });
}

describe("accounts and passports", () => {
  test("mint returns a passport id and invoke key, and never echoes the key hash", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "PR agent",
      ttlMs: 60_000,
      apps: ["github", "gmail", "slack"],
    });
    expect(minted.passportId.startsWith("pp_")).toBe(true);
    expect(minted.invokeKey.startsWith("ik_")).toBe(true);
    const listed = await test.query(api.passports.list, { now: Date.now() });
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("invokeKey");
    expect(listed[0]).not.toHaveProperty("invokeKeyHash");
    expect(listed[0]?.token).toBe(minted.passportId);
  });

  test("setPlatform turns one platform off without turning the others off", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Multi",
      ttlMs: 60_000,
      apps: ["github", "gmail", "slack"],
    });
    await test.mutation(api.passports.setPlatform, {
      passportId: minted.passportId,
      platform: "gmail",
      enabled: false,
    });
    const passport = await test.query(api.passports.get, {
      passportId: minted.id,
      now: Date.now(),
    });
    expect(passport?.apps.sort()).toEqual(["github", "slack"]);
    const toggled = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      kind: "platform_toggled",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(toggled.page).toHaveLength(1);
    expect(toggled.page[0]?.reason).toBe("Disabled gmail");
    expect(toggled.page[0]?.scopes).toEqual(["gmail"]);
  });

  test("disconnecting github does not wipe passports or logs", async () => {
    const test = t();
    await seedGithub(test);
    const minted = await test.mutation(api.passports.mint, {
      name: "Keep me",
      ttlMs: 60_000,
      apps: ["github", "demo"],
    });
    await test.action(api.connections.disconnect, { provider: "github" });
    const github = await test.query(api.connections.status, {
      provider: "github",
    });
    expect(github).toEqual({ connected: false });
    const passport = await test.query(api.passports.get, {
      passportId: minted.id,
      now: Date.now(),
    });
    expect(passport?.name).toBe("Keep me");
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page.length).toBeGreaterThan(0);
    expect(history.page[0]?.kind).toBe("issued");
  });
});

describe("platform tokens", () => {
  test("connecting an account does not mint access by itself", async () => {
    const test = t();
    await seedGithub(test);
    const minted = await test.mutation(api.passports.mint, {
      name: "Demo only",
      ttlMs: 60_000,
      apps: ["demo"],
    });
    const denied = await test.mutation(internal.tokens.authorizeMint, {
      passportToken: minted.passportId,
      invokeKey: minted.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(denied).toEqual({
      ok: false,
      status: 403,
      reason: "Platform is off",
    });
    const logs = await test.query(api.tokens.listLogs, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(logs.page).toHaveLength(1);
    expect(logs.page[0]?.kind).toBe("mint_denied");
    expect(logs.page[0]?.platform).toBe("github");
    expect(logs.page[0]?.reason).toBe("Platform is off");
    expect(logs.page[0]).not.toHaveProperty("accessToken");
  });

  test("issues a short-lived token while live and on, and refresh kills the previous", async () => {
    const test = t();
    await seedGithub(test);
    const minted = await test.mutation(api.passports.mint, {
      name: "GitHub agent",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const allowed = await test.mutation(internal.tokens.authorizeMint, {
      passportToken: minted.passportId,
      invokeKey: minted.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) {
      throw new Error("expected authorize");
    }
    const first = await test.mutation(internal.tokens.commitMint, {
      passportId: allowed.passportId,
      platform: "github",
      accessToken: "ghs_first",
      expiresAt: Date.now() + 60_000,
      refresh: false,
    });
    expect(first.revokedPrevious).toBe(false);
    const second = await test.mutation(internal.tokens.commitMint, {
      passportId: allowed.passportId,
      platform: "github",
      accessToken: "ghs_second",
      expiresAt: Date.now() + 60_000,
      refresh: true,
    });
    expect(second.revokedPrevious).toBe(true);
    const live = await test.query(api.tokens.listLive, {
      passportId: minted.id,
      now: Date.now(),
    });
    expect(live).toHaveLength(1);
    expect(live[0]?.platform).toBe("github");
    expect(JSON.stringify(live)).not.toMatch(/ghs_/);
    const logs = await test.query(api.tokens.listLogs, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(logs.page.map((row) => row.kind)).toEqual([
      "refreshed",
      "revoked",
      "issued",
    ]);
    expect(JSON.stringify(logs.page)).not.toMatch(/ghs_/);
  });

  test("after expiry, revoke, or platform-off, mint is denied", async () => {
    const test = t();
    await seedGithub(test);
    const minted = await test.mutation(api.passports.mint, {
      name: "Gates",
      ttlMs: 60_000,
      apps: ["github"],
    });

    await test.mutation(api.passports.setPlatform, {
      passportId: minted.passportId,
      platform: "github",
      enabled: false,
    });
    const off = await test.mutation(internal.tokens.authorizeMint, {
      passportToken: minted.passportId,
      invokeKey: minted.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(off).toMatchObject({ ok: false, reason: "Platform is off" });

    await test.mutation(api.passports.setPlatform, {
      passportId: minted.passportId,
      platform: "github",
      enabled: true,
    });
    await test.mutation(api.passports.revoke, {
      passportId: minted.passportId,
    });
    const revoked = await test.mutation(internal.tokens.authorizeMint, {
      passportToken: minted.passportId,
      invokeKey: minted.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(revoked).toMatchObject({ ok: false, reason: "Passport revoked" });

    const short = await test.mutation(api.passports.mint, {
      name: "Short",
      ttlMs: 60_000,
      apps: ["github"],
    });
    await test.run(async (ctx) => {
      await ctx.db.patch("passports", short.id, {
        expiresAt: Date.now() - 1_000,
      });
    });
    const expired = await test.mutation(internal.tokens.authorizeMint, {
      passportToken: short.passportId,
      invokeKey: short.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(expired).toMatchObject({ ok: false, reason: "Passport expired" });
  });

  test("turning one platform off revokes only that platform’s token", async () => {
    const test = t();
    await seedGithub(test);
    await seedSlack(test);
    const minted = await test.mutation(api.passports.mint, {
      name: "Two",
      ttlMs: 60_000,
      apps: ["github", "slack"],
    });
    await test.mutation(internal.tokens.commitMint, {
      passportId: minted.id,
      platform: "github",
      accessToken: "ghs_live",
      expiresAt: Date.now() + 60_000,
      refresh: false,
    });
    await test.mutation(internal.tokens.commitMint, {
      passportId: minted.id,
      platform: "slack",
      accessToken: "xoxp-live",
      expiresAt: Date.now() + 60_000,
      refresh: false,
    });
    await test.mutation(api.passports.setPlatform, {
      passportId: minted.passportId,
      platform: "github",
      enabled: false,
    });
    const live = await test.query(api.tokens.listLive, {
      passportId: minted.id,
      now: Date.now(),
    });
    expect(live.map((row) => row.platform)).toEqual(["slack"]);
  });

  test("revoking the passport revokes every token on it", async () => {
    const test = t();
    await seedGithub(test);
    await seedSlack(test);
    const minted = await test.mutation(api.passports.mint, {
      name: "All",
      ttlMs: 60_000,
      apps: ["github", "slack"],
    });
    await test.mutation(internal.tokens.commitMint, {
      passportId: minted.id,
      platform: "github",
      accessToken: "ghs_live",
      expiresAt: Date.now() + 60_000,
      refresh: false,
    });
    await test.mutation(internal.tokens.commitMint, {
      passportId: minted.id,
      platform: "slack",
      accessToken: "xoxp-live",
      expiresAt: Date.now() + 60_000,
      refresh: false,
    });
    await test.mutation(api.passports.revoke, {
      passportId: minted.passportId,
    });
    const live = await test.query(api.tokens.listLive, {
      passportId: minted.id,
      now: Date.now(),
    });
    expect(live).toEqual([]);
    const logs = await test.query(api.tokens.listLogs, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(logs.page.filter((row) => row.kind === "revoked").length).toBe(2);
  });

  test("invalid invoke key is refused with a logged reason", async () => {
    const test = t();
    await seedGithub(test);
    const minted = await test.mutation(api.passports.mint, {
      name: "Keyed",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const denied = await test.mutation(internal.tokens.authorizeMint, {
      passportToken: minted.passportId,
      invokeKey: "ik_wrong",
      platform: "github",
      refresh: false,
    });
    expect(denied).toMatchObject({
      ok: false,
      status: 401,
      reason: "Invalid invoke key",
    });
  });

  test("google connection covers gmail through sheets on one provider", async () => {
    const test = t();
    await test.mutation(internal.connections.saveConnection, {
      provider: "google",
      accessToken: "ya29.standing",
      login: "user@gmail.com",
      providerUserId: "sub",
    });
    const minted = await test.mutation(api.passports.mint, {
      name: "Workspace",
      ttlMs: 60_000,
      apps: ["gmail", "calendar", "drive", "docs", "sheets"],
    });
    for (const platform of ["gmail", "calendar", "drive", "docs", "sheets"] as const) {
      const allowed = await test.mutation(internal.tokens.authorizeMint, {
        passportToken: minted.passportId,
        invokeKey: minted.invokeKey,
        platform,
        refresh: false,
      });
      expect(allowed).toMatchObject({ ok: true, provider: "google", platform });
    }
  });
});
