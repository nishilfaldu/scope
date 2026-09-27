/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { sha256Hex } from "../convex/lib/secrets";

const modules = import.meta.glob("../convex/**/*.ts");
const backend = () => convexTest(schema, modules);

async function connectAgent(
  t: ReturnType<typeof backend>,
  userId: Id<"users">,
  name = "Agent",
) {
  const secret = `acs_${name}`;
  const id = await t.run(async (ctx) =>
    ctx.db.insert("agentConnections", {
      userId,
      agentId: `ag_${name}`,
      name,
      secretHash: await sha256Hex(secret),
      status: "active",
    }),
  );
  return { id, secret };
}

describe("request link decisions", () => {
  test("a new-slice link is bound to its connected Scope account before approval", async () => {
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
    const agent = await connectAgent(t, owner);
    const created = await t.mutation(
      internal.tables.slices.sliceRequestClaims.createSliceRequest,
      {
        agentConnectionId: agent.id,
        agentConnectionSecret: agent.secret,
        apps: ["gmail"],
        ttlMs: 60_000,
        reason: "Read the inbox",
      },
    );
    if (!created.ok) throw new Error("request creation failed");
    expect(
      await t.run((ctx) => ctx.db.get("sliceRequests", created.requestId)),
    ).toMatchObject({ agentId: "ag_Agent" });
    expect(
      await ownerSession.query(api.tables.slices.sliceRequests.get, {
        publicToken: created.publicToken,
      }),
    ).toMatchObject({ agentName: "Agent", apps: ["gmail"] });
    await expect(
      t.mutation(api.tables.slices.sliceRequests.decide, {
        publicToken: created.publicToken,
        decision: "approved",
      }),
    ).rejects.toThrow();
    await expect(
      otherSession.mutation(api.tables.slices.sliceRequests.decide, {
        publicToken: created.publicToken,
        decision: "approved",
        bindings: [{ app: "gmail", connectionId: connection }],
      }),
    ).rejects.toThrow();
    await ownerSession.mutation(api.tables.slices.sliceRequests.decide, {
      publicToken: created.publicToken,
      decision: "approved",
      bindings: [{ app: "gmail", connectionId: connection }],
    });
    const approved = await t.run(async (ctx) => {
      const request = await ctx.db.get("sliceRequests", created.requestId);
      const slice = request?.createdSliceId
        ? await ctx.db.get("slices", request.createdSliceId)
        : null;
      return { request, slice };
    });
    expect(approved.request?.status).toBe("approved");
    expect(approved.slice).toMatchObject({
      userId: owner,
      agentId: "ag_Agent",
      name: "Agent",
      status: "staged",
    });
    await expect(
      ownerSession.mutation(api.tables.slices.sliceRequests.decide, {
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
      internal.tables.slices.mutations.createFixture,
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
      internal.tables.slices.tokenRequestClaims.createPending,
      {
        sliceId: slice.id,
        app: "gmail",
        bindingId: binding._id,
      },
    );
    if (!pending.ok) throw new Error("request creation failed");
    expect(
      await otherSession.query(api.tables.slices.tokenRequests.get, {
        publicToken: pending.publicToken,
      }),
    ).toBeNull();
    await expect(
      otherSession.mutation(api.tables.slices.tokenRequests.decide, {
        publicToken: pending.publicToken,
        decision: "denied",
      }),
    ).rejects.toThrow(/unavailable/);
    expect(
      await ownerSession.query(api.tables.slices.tokenRequests.get, {
        publicToken: pending.publicToken,
      }),
    ).toMatchObject({
      accountLogin: "connected@gmail.com",
      sliceName: "Agent",
    });
    await ownerSession.mutation(api.tables.slices.tokenRequests.decide, {
      publicToken: pending.publicToken,
      decision: "denied",
    });
    expect(
      (await t.run((ctx) => ctx.db.get("tokenRequests", pending.requestId)))
        ?.status,
    ).toBe("denied");
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
    const agent = await connectAgent(t, userId);
    const denied = await t.mutation(
      internal.tables.slices.sliceRequestClaims.createSliceRequest,
      {
        agentConnectionId: agent.id,
        agentConnectionSecret: agent.secret,
        apps: ["github"],
        ttlMs: 60_000,
        reason: "Test denial",
      },
    );
    if (!denied.ok) throw new Error("request creation failed");
    await session.mutation(api.tables.slices.sliceRequests.decide, {
      publicToken: denied.publicToken,
      decision: "denied",
    });
    const saved = await t.run((ctx) =>
      ctx.db.get("sliceRequests", denied.requestId),
    );
    expect(saved?.status).toBe("denied");
    expect(
      await t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("slices")
              .withIndex("by_agentId", (q) => q.eq("agentId", "ag_Agent"))
              .collect()
          ).length,
      ),
    ).toBe(0);
    const expired = await t.mutation(
      internal.tables.slices.sliceRequestClaims.createSliceRequest,
      {
        agentConnectionId: agent.id,
        agentConnectionSecret: agent.secret,
        apps: ["github"],
        ttlMs: 60_000,
        reason: "Test expiry",
      },
    );
    if (!expired.ok) throw new Error("request creation failed");
    await t.run((ctx) =>
      ctx.db.patch("sliceRequests", expired.requestId, {
        approvalDeadlineAt: Date.now() - 1,
      }),
    );
    await expect(
      session.mutation(api.tables.slices.sliceRequests.decide, {
        publicToken: expired.publicToken,
        decision: "denied",
      }),
    ).rejects.toThrow(/no longer pending/);
  });
});
