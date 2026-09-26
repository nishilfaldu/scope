/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { Resend } from "@convex-dev/resend";
import { expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

test("email OTP creates a session only on valid code and cannot be replayed", async () => {
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  const t = convexTest(schema, modules);
  let message = "";
  const send = vi
    .spyOn(Resend.prototype, "sendEmail")
    .mockImplementation(async (_ctx, options) => {
      if (typeof options !== "string") message = options.text ?? "";
      return "test-email-id" as never;
    });
  try {
    await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email: "login@example.com" },
    });
    const code = message.match(/\b\d{6}\b/)?.[0];
    expect(message).toContain(`\n\n${code}\n\n`);
    expect(code).toMatch(/^\d{6}$/);
    const before = await t.run(
      async (ctx) => (await ctx.db.query("authSessions").collect()).length,
    );
    expect(before).toBe(0);
    await expect(
      t.action(api.auth.signIn, {
        provider: "email-otp",
        params: {
          email: "login@example.com",
          code: "0".repeat(6) === code ? "1".repeat(6) : "0".repeat(6),
        },
      }),
    ).rejects.toThrow();
    expect(
      await t.mutation(internal.auth.store, {
        args: {
          type: "verifyCodeAndSignIn",
          provider: "email-otp",
          params: { email: "someone-else@example.com", code },
          generateTokens: false,
          allowExtraProviders: false,
        },
      }),
    ).toBeNull();
    const signedIn = await t.mutation(internal.auth.store, {
      args: {
        type: "verifyCodeAndSignIn",
        provider: "email-otp",
        params: { email: "login@example.com", code },
        generateTokens: false,
        allowExtraProviders: false,
      },
    });
    expect(signedIn).toMatchObject({ tokens: null });
    expect(
      await t.run(
        async (ctx) => (await ctx.db.query("authSessions").collect()).length,
      ),
    ).toBe(1);
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.query("users").collect())[0].emailVerificationTime,
      ),
    ).toBeTypeOf("number");
    expect(
      await t.mutation(internal.auth.store, {
        args: {
          type: "verifyCodeAndSignIn",
          provider: "email-otp",
          params: { email: "login@example.com", code },
          generateTokens: false,
          allowExtraProviders: false,
        },
      }),
    ).toBeNull();
    await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email: "late@example.com" },
    });
    const lateCode = message.match(/\b\d{6}\b/)?.[0];
    await t.run(async (ctx) => {
      const codeRow = (
        await ctx.db.query("authVerificationCodes").collect()
      )[0];
      await ctx.db.patch("authVerificationCodes", codeRow._id, {
        expirationTime: Date.now() - 1,
      });
    });
    expect(
      await t.mutation(internal.auth.store, {
        args: {
          type: "verifyCodeAndSignIn",
          provider: "email-otp",
          params: { email: "late@example.com", code: lateCode },
          generateTokens: false,
          allowExtraProviders: false,
        },
      }),
    ).toBeNull();
    expect(
      await t.run(
        async (ctx) => (await ctx.db.query("authSessions").collect()).length,
      ),
    ).toBe(1);
  } finally {
    send.mockRestore();
    vi.unstubAllEnvs();
  }
});

test("an email identifier links only to a user who previously verified it", async () => {
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  const send = vi
    .spyOn(Resend.prototype, "sendEmail")
    .mockResolvedValue("test-email-id" as never);
  try {
    const t = convexTest(schema, modules);
    const verified = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "verified@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const unverified = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "unverified@example.com",
      }),
    );
    await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email: "verified@example.com" },
    });
    await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email: "unverified@example.com" },
    });
    const accounts = await t.run(async (ctx) =>
      ctx.db.query("authAccounts").collect(),
    );
    expect(
      accounts.find(
        (account) => account.providerAccountId === "verified@example.com",
      )?.userId,
    ).toBe(verified);
    expect(
      accounts.find(
        (account) => account.providerAccountId === "unverified@example.com",
      )?.userId,
    ).not.toBe(unverified);
  } finally {
    send.mockRestore();
    vi.unstubAllEnvs();
  }
});

test("identical live and expired codes verify for the intended account", async () => {
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  const sent = new Map<string, string>();
  const send = vi
    .spyOn(Resend.prototype, "sendEmail")
    .mockImplementation(async (_ctx, options) => {
      if (typeof options !== "string")
        sent.set(options.to as string, options.text ?? "");
      return "test-email-id" as never;
    });
  try {
    const t = convexTest(schema, modules);
    for (const email of [
      "live-a@example.com",
      "live-b@example.com",
      "expired@example.com",
    ]) {
      await t.action(api.auth.signIn, {
        provider: "email-otp",
        params: { email },
      });
    }
    const codeFor = (email: string) => sent.get(email)?.match(/\b\d{6}\b/)?.[0];
    const a = codeFor("live-a@example.com");
    const b = codeFor("live-b@example.com");
    const expired = codeFor("expired@example.com");
    expect(a).toMatch(/^\d{6}$/);
    expect(b).toMatch(/^\d{6}$/);
    expect(expired).toMatch(/^\d{6}$/);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("authVerificationCodes").collect();
      await ctx.db.patch("authVerificationCodes", rows[1]._id, {
        code: rows[0].code,
      });
      await ctx.db.patch("authVerificationCodes", rows[2]._id, {
        code: rows[0].code,
        expirationTime: Date.now() - 1,
      });
    });
    expect(
      await t.mutation(internal.auth.store, {
        args: {
          type: "verifyCodeAndSignIn",
          provider: "email-otp",
          params: { email: "missing@example.com", code: a },
          generateTokens: false,
          allowExtraProviders: false,
        },
      }),
    ).toBeNull();
    for (const [email, code] of [
      ["live-a@example.com", a],
      ["live-b@example.com", a],
    ] as const) {
      const result = await t.mutation(internal.auth.store, {
        args: {
          type: "verifyCodeAndSignIn",
          provider: "email-otp",
          params: { email, code },
          generateTokens: false,
          allowExtraProviders: false,
        },
      });
      expect(result).toMatchObject({ tokens: null });
    }
    expect(
      await t.mutation(internal.auth.store, {
        args: {
          type: "verifyCodeAndSignIn",
          provider: "email-otp",
          params: { email: "expired@example.com", code: a },
          generateTokens: false,
          allowExtraProviders: false,
        },
      }),
    ).toBeNull();
    expect(
      await t.run(
        async (ctx) => (await ctx.db.query("authSessions").collect()).length,
      ),
    ).toBe(2);
  } finally {
    send.mockRestore();
    vi.unstubAllEnvs();
  }
});
