/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { ensurePassport } from "../convex/tables/passports";
import {
  TOKEN_CIPHER_PREFIX,
  decryptToken,
  encryptToken,
  isEncryptedToken,
} from "../convex/lib/tokenEncryption";

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
    await ensurePassport(ctx, userId);
  });
  return {
    backend: test.withIdentity({ subject: `${userId}|session-1` }),
    userId,
  };
}

describe("token encryption helpers", () => {
  test("round-trips plaintext through AES-GCM with enc:v1 prefix", async () => {
    const plaintext = "ghs_standing_token";
    const encrypted = await encryptToken(plaintext);
    expect(isEncryptedToken(encrypted)).toBe(true);
    expect(encrypted.startsWith(TOKEN_CIPHER_PREFIX)).toBe(true);
    expect(encrypted).not.toContain(plaintext);
    expect(await decryptToken(encrypted)).toBe(plaintext);
  });

  test("decrypt rejects plaintext-looking stored values", async () => {
    await expect(decryptToken("ya29.not_encrypted")).rejects.toThrow(
      /not encrypted/,
    );
    expect(isEncryptedToken("ya29.not_encrypted")).toBe(false);
  });
});

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
        .withIndex("by_user_provider_app_providerUserId", (q) =>
          q.eq("userId", userId).eq("provider", "github").eq("app", "github"),
        )
        .unique();
    });
    expect(stored).not.toBeNull();
    expect(stored!.accessToken).not.toBe(accessToken);
    expect(stored!.accessToken.startsWith(TOKEN_CIPHER_PREFIX)).toBe(true);
    expect(stored!.refreshToken).not.toBe(refreshToken);
    expect(stored!.refreshToken!.startsWith(TOKEN_CIPHER_PREFIX)).toBe(true);

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
        provider: "github",
        app: "github",
        accessToken: "ghs_plaintext_stored",
        login: "octocat",
        providerUserId: "1",
        refreshToken: "ghr_plaintext_stored",
      });
    });

    await expect(
      test.query(internal.tables.connections.queries.getConnection, {
        userId,
        app: "github", connectionId,
      }),
    ).rejects.toThrow(/not encrypted/);
  });

  test("listStatuses omits access and refresh tokens", async () => {
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
      api.tables.connections.queries.listStatuses,
      {},
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
