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

  test("mint rejects an empty name, a name that is too long, and a TTL over 7 days", async () => {
    const test = t();
    await expect(
      test.mutation(api.passports.mint, {
        name: "   ",
        ttlMs: 60_000,
        apps: ["github"],
      }),
    ).rejects.toThrow(/Name must be non-empty/);
    await expect(
      test.mutation(api.passports.mint, {
        name: "n".repeat(81),
        ttlMs: 60_000,
        apps: ["github"],
      }),
    ).rejects.toThrow(/80 characters/);
    await expect(
      test.mutation(api.passports.mint, {
        name: "Long",
        ttlMs: 8 * 24 * 60 * 60 * 1000,
        apps: ["github"],
      }),
    ).rejects.toThrow(/7 days/);
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
      apps: ["github", "slack"],
    });
    await test.action(api.connections.disconnect, { provider: "github" });
    const statuses = await test.query(api.connections.listStatuses, {});
    expect(
      statuses.find((row) => row.provider === "github"),
    ).toEqual({ provider: "github", connected: false, login: null });
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
      name: "Slack only",
      ttlMs: 60_000,
      apps: ["slack"],
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
      reason: "This platform is not available on this passport",
      code: "platform_unavailable",
    });
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page).toHaveLength(2);
    expect(history.page[0]?.kind).toBe("mint_denied");
    expect(history.page[0]?.platform).toBe("github");
    expect(history.page[0]?.reason).toBe(
      "This platform is not available on this passport",
    );
    expect(history.page[0]?.outcome).toBe("denied");
    expect(JSON.stringify(history.page)).not.toMatch(/ghs_|ya29|xoxp/);
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
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page.map((row) => row.kind)).toEqual([
      "token_refreshed",
      "token_revoked",
      "token_issued",
      "issued",
    ]);
    expect(JSON.stringify(history.page)).not.toMatch(/ghs_/);
    const chain = await test.query(api.audit.chainStatus, {
      passportId: minted.id,
    });
    expect(chain).toEqual({
      eventCount: 4,
      expectedSeq: 4,
      intact: true,
    });
  });

  test("a second mint without refresh returns the live token and does not rotate", async () => {
    const test = t();
    await seedGithub(test);
    const minted = await test.mutation(api.passports.mint, {
      name: "GitHub agent",
      ttlMs: 60_000,
      apps: ["github"],
    });
    await test.mutation(internal.tokens.commitMint, {
      passportId: minted.id,
      platform: "github",
      accessToken: "ghs_live",
      expiresAt: Date.now() + 10 * 60 * 1000,
      refresh: false,
    });
    const reused = await test.mutation(internal.tokens.authorizeMint, {
      passportToken: minted.passportId,
      invokeKey: minted.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(reused).toMatchObject({
      ok: true,
      liveAccessToken: "ghs_live",
      refresh: false,
    });
    const rotate = await test.mutation(internal.tokens.authorizeMint, {
      passportToken: minted.passportId,
      invokeKey: minted.invokeKey,
      platform: "github",
      refresh: true,
    });
    expect(rotate).toMatchObject({
      ok: true,
      liveAccessToken: null,
      liveExpiresAt: null,
      refresh: true,
    });
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page.filter((row) => row.kind === "token_issued")).toHaveLength(
      1,
    );
    expect(JSON.stringify(history.page)).not.toMatch(/ghs_/);
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
    expect(off).toMatchObject({
      ok: false,
      reason: "This platform is not available on this passport",
      code: "platform_unavailable",
    });

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
    expect(revoked).toMatchObject({
      ok: false,
      reason: "Passport revoked",
      code: "revoked",
    });

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
    expect(expired).toMatchObject({
      ok: false,
      reason: "Passport expired",
      code: "expired",
    });
  });

  test("unknown, off, and unconnected platforms share one denial", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "GitHub only",
      ttlMs: 60_000,
      apps: ["github"],
    });
    const unavailable = {
      ok: false,
      status: 403,
      reason: "This platform is not available on this passport",
      code: "platform_unavailable",
    };
    const unknown = await test.mutation(internal.tokens.authorizeMint, {
      passportToken: minted.passportId,
      invokeKey: minted.invokeKey,
      platform: "dropbox",
      refresh: false,
    });
    expect(unknown).toMatchObject(unavailable);
    const unconnected = await test.mutation(internal.tokens.authorizeMint, {
      passportToken: minted.passportId,
      invokeKey: minted.invokeKey,
      platform: "github",
      refresh: false,
    });
    expect(unconnected).toMatchObject(unavailable);
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
    expect(off).toMatchObject(unavailable);
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
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(
      history.page.filter((row) => row.kind === "token_revoked").length,
    ).toBe(2);
  });

  test("expireDue revokes live platform tokens whose TTL has elapsed", async () => {
    const test = t();
    await seedGithub(test);
    const minted = await test.mutation(api.passports.mint, {
      name: "TTL",
      ttlMs: 60_000,
      apps: ["github"],
    });
    await test.mutation(internal.tokens.commitMint, {
      passportId: minted.id,
      platform: "github",
      accessToken: "ghs_live",
      expiresAt: Date.now() + 60_000,
      refresh: false,
    });
    const tokens = await test.run(async (ctx) => {
      return await ctx.db
        .query("platformTokens")
        .withIndex("by_passport", (q) => q.eq("passportId", minted.id))
        .take(10);
    });
    const live = tokens.find((row) => row.status === "live");
    expect(live).toBeDefined();
    await test.run(async (ctx) => {
      await ctx.db.patch("platformTokens", live!._id, {
        expiresAt: Date.now() - 1_000,
      });
    });
    const expiredCount = await test.mutation(internal.audit.expireDue, {});
    expect(expiredCount).toBe(0);
    const after = await test.query(api.tokens.listLive, {
      passportId: minted.id,
      now: Date.now(),
    });
    expect(after).toEqual([]);
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      kind: "token_revoked",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page).toHaveLength(1);
    expect(history.page[0]?.reason).toBe("Time to live elapsed");
    expect(JSON.stringify(history.page)).not.toMatch(/ghs_/);
  });

  test("disconnecting github revokes github copies and leaves slack live", async () => {
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
      expiresAt: Date.now() + 10 * 60 * 1000,
      refresh: false,
    });
    await test.mutation(internal.tokens.commitMint, {
      passportId: minted.id,
      platform: "slack",
      accessToken: "xoxp-live",
      expiresAt: Date.now() + 10 * 60 * 1000,
      refresh: false,
    });
    await test.action(api.connections.disconnect, { provider: "github" });
    const live = await test.query(api.tokens.listLive, {
      passportId: minted.id,
      now: Date.now(),
    });
    expect(live.map((row) => row.platform)).toEqual(["slack"]);
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      kind: "token_revoked",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page).toHaveLength(1);
    expect(history.page[0]?.platform).toBe("github");
    expect(history.page[0]?.reason).toBe("Provider disconnected");
    expect(JSON.stringify(history.page)).not.toMatch(/ghs_|xoxp/);
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
      reason: "Unknown passport or invoke key",
      code: "unauthorized",
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
