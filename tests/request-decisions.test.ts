/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const backend = () => convexTest(schema, modules);

describe("request link decisions", () => {
  test("an unowned new-slice link requires a signed-in decision and attaches only on approval", async () => {
    const t = backend();
    const owner = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "login@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const other = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "other@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const ownerSession = t.withIdentity({ subject: `${owner}|session` });
    const otherSession = t.withIdentity({ subject: `${other}|session` });
    await t.mutation(internal.tables.connections.mutations.saveConnection, {
      userId: owner,
      provider: "google",
      app: "gmail",
      providerUserId: "provider-sub",
      login: "different-provider@gmail.com",
      accessToken: "standing",
      refreshToken: "refresh",
    });
    const connection = (
      await ownerSession.query(api.tables.connections.queries.statusesForApps, {
        apps: ["gmail"],
      })
    )[0].accounts[0].id;
    const created = await t.mutation(
      internal.tables.slices.onboardingAccess.createOnboarding,
      {
        agentName: "Agent",
        apps: ["gmail"],
        ttlMs: 60_000,
      },
    );
    if (!created.ok) throw new Error("request creation failed");
    expect(
      await t.run((ctx) => ctx.db.get("accessRequests", created.requestId)),
    ).not.toHaveProperty("userId");
    expect(
      await ownerSession.query(api.tables.slices.accessRequests.getNewSlice, {
        publicToken: created.publicToken,
      }),
    ).toMatchObject({ agentName: "Agent", apps: ["gmail"] });
    await expect(
      t.mutation(api.tables.slices.accessRequests.decide, {
        publicToken: created.publicToken,
        decision: "approved",
      }),
    ).rejects.toThrow();
    await expect(
      otherSession.mutation(api.tables.slices.accessRequests.decide, {
        publicToken: created.publicToken,
        decision: "approved",
        bindings: [{ app: "gmail", connectionId: connection }],
      }),
    ).rejects.toThrow();
    await ownerSession.mutation(api.tables.slices.accessRequests.decide, {
      publicToken: created.publicToken,
      decision: "approved",
      bindings: [{ app: "gmail", connectionId: connection }],
    });
    const saved = await t.run((ctx) =>
      ctx.db.get("accessRequests", created.requestId),
    );
    expect(saved?.userId).toBe(owner);
    expect(saved?.sliceId).toBeTruthy();
    await expect(
      ownerSession.mutation(api.tables.slices.accessRequests.decide, {
        publicToken: created.publicToken,
        decision: "approved",
        bindings: [{ app: "gmail", connectionId: connection }],
      }),
    ).rejects.toThrow(/no longer pending/);
  });

  test("a token link cannot be read or denied by another user, even with the provider login email", async () => {
    const t = backend();
    const owner = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "login@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const other = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "connected@gmail.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const ownerSession = t.withIdentity({ subject: `${owner}|session` });
    const otherSession = t.withIdentity({ subject: `${other}|session` });
    await t.mutation(internal.tables.connections.mutations.saveConnection, {
      userId: owner,
      provider: "google",
      app: "gmail",
      providerUserId: "provider-sub",
      login: "connected@gmail.com",
      accessToken: "standing",
      refreshToken: "refresh",
    });
    const connection = (
      await ownerSession.query(api.tables.connections.queries.statusesForApps, {
        apps: ["gmail"],
      })
    )[0].accounts[0].id;
    const slice = await ownerSession.mutation(
      api.tables.slices.mutations.create,
      {
        name: "Agent",
        apps: ["gmail"],
        ttlMs: 60_000,
        mintPolicy: "approve",
        bindings: [{ app: "gmail", connectionId: connection }],
      },
    );
    const binding = await t.run(
      async (ctx) =>
        (await ctx.db
          .query("sliceBindings")
          .withIndex("by_slice_app_connectionId", (q) =>
            q.eq("sliceId", slice.id).eq("app", "gmail"),
          )
          .unique())!,
    );
    const pending = await t.mutation(
      internal.tables.slices.accessRequestsMint.createPending,
      {
        sliceId: slice.id,
        userId: owner,
        app: "gmail",
        bindingId: binding._id,
      },
    );
    if (!pending.ok) throw new Error("request creation failed");
    expect(
      await otherSession.query(api.tables.slices.accessRequests.getToken, {
        publicToken: pending.publicToken,
      }),
    ).toBeNull();
    await expect(
      otherSession.mutation(api.tables.slices.accessRequests.decide, {
        publicToken: pending.publicToken,
        decision: "denied",
      }),
    ).rejects.toThrow(/unavailable/);
    expect(
      await ownerSession.query(api.tables.slices.accessRequests.getToken, {
        publicToken: pending.publicToken,
      }),
    ).toMatchObject({
      accountLogin: "connected@gmail.com",
      sliceName: "Agent",
    });
    await ownerSession.mutation(api.tables.slices.accessRequests.decide, {
      publicToken: pending.publicToken,
      decision: "denied",
    });
    expect(
      (await t.run((ctx) => ctx.db.get("accessRequests", pending.requestId)))
        ?.status,
    ).toBe("denied");
  });

  test("OTP send throttle uses canonical email and bounds sends", async () => {
    vi.useFakeTimers();
    try {
      const t = backend();
      for (let attempt = 0; attempt < 5; attempt++) {
        expect(
          await t.mutation(internal.otp.allowSend, {
            email: attempt % 2 ? "ME@example.com" : "me@example.com",
          }),
        ).toBe(true);
        vi.advanceTimersByTime(60_001);
      }
      expect(
        await t.mutation(internal.otp.allowSend, { email: "me@example.com" }),
      ).toBe(false);
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(
        await t.mutation(internal.otp.allowSend, { email: "me@example.com" }),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("denial creates no slice and expired links cannot be decided", async () => {
    const t = backend();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "verified@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const session = t.withIdentity({ subject: `${userId}|session` });
    const denied = await t.mutation(
      internal.tables.slices.onboardingAccess.createOnboarding,
      {
        agentName: "Agent",
        apps: ["github"],
        ttlMs: 60_000,
      },
    );
    if (!denied.ok) throw new Error("request creation failed");
    await session.mutation(api.tables.slices.accessRequests.decide, {
      publicToken: denied.publicToken,
      decision: "denied",
    });
    const saved = await t.run((ctx) =>
      ctx.db.get("accessRequests", denied.requestId),
    );
    expect(saved?.status).toBe("denied");
    expect(saved?.userId).toBeUndefined();
    expect(saved?.sliceId).toBeUndefined();
    const expired = await t.mutation(
      internal.tables.slices.onboardingAccess.createOnboarding,
      {
        agentName: "Other",
        apps: ["github"],
        ttlMs: 60_000,
      },
    );
    if (!expired.ok) throw new Error("request creation failed");
    await t.run((ctx) =>
      ctx.db.patch("accessRequests", expired.requestId, {
        expiresAt: Date.now() - 1,
      }),
    );
    await expect(
      session.mutation(api.tables.slices.accessRequests.decide, {
        publicToken: expired.publicToken,
        decision: "denied",
      }),
    ).rejects.toThrow(/no longer pending/);
  });
});
