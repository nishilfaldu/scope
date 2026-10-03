/// <reference types="vite/client" />
import { managedGrant, managedFixture } from "./helpers/connect";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { sha256Hex } from "../convex/lib/secrets";

const modules = import.meta.glob("../convex/**/*.ts");
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function owner(t: ReturnType<typeof convexTest>, email: string) {
  const id = await t.run((ctx) => ctx.db.insert("users", { email }));
  return { id, session: t.withIdentity({ subject: `${id}|session` }) };
}

test("pending request limits are isolated per owner and exclude expired requests", async () => {
  const t = convexTest(schema, modules);
  const first = await owner(t, "first@example.com");
  const second = await owner(t, "second@example.com");
  const agentSecret = "agent-secret";
  const agentConnectionId = await t.run(async (ctx) => {
    for (let i = 0; i < 100; i++) {
      await ctx.db.insert("sliceRequests", {
        userId: first.id,
        agentId: "first-agent",
        publicToken: `first-${i}`,
        claimSecretHash: `hash-${i}`,
        status: "pending",
        approvalDeadlineAt: Date.now() + 60_000,
        apps: ["slack"],
        ttlMs: 60_000,
        reason: "first",
      });
    }
    await ctx.db.insert("sliceRequests", {
      userId: second.id,
      agentId: "second-agent",
      publicToken: "expired",
      claimSecretHash: "expired-hash",
      status: "pending",
      approvalDeadlineAt: Date.now() - 1,
      apps: ["slack"],
      ttlMs: 60_000,
      reason: "expired",
    });
    return await ctx.db.insert("agentConnections", {
      userId: second.id,
      agentId: "second-agent",
      name: "Second",
      secretHash: await sha256Hex(agentSecret),
      status: "active",
    });
  });
  const result = await t.mutation(
    internal.tables.slices.sliceRequestClaims.createSliceRequest,
    {
      agentConnectionId,
      agentConnectionSecret: agentSecret,
      apps: ["slack"],
      ttlMs: 60_000,
      reason: "second owner's first request",
    },
  );
  expect(result).toMatchObject({ ok: true });
});

test("the operator's mint policy is enforced at issuance and after a live policy change", async () => {
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  const agentSecret = "agent-secret";
  const agentConnectionId = await t.run(async (ctx) =>
    ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "agent",
      name: "Agent",
      status: "active",
      secretHash: await sha256Hex(agentSecret),
    }),
  );
  await t.mutation(
    internal.connect.connections.save,
    managedFixture({ userId: id, login: "slack", providerUserId: "1" }),
  );
  const connectionId = (await t.run((ctx) =>
    ctx.db.query("connections").unique(),
  ))!._id;
  const request = await t.mutation(
    internal.tables.slices.sliceRequestClaims.createSliceRequest,
    {
      agentConnectionId,
      agentConnectionSecret: agentSecret,
      apps: ["slack"],
      ttlMs: 60_000,
      reason: "test policy",
    },
  );
  if (!request.ok) throw new Error(request.reason);
  await session.mutation(api.tables.slices.sliceRequests.decide, {
    publicToken: request.publicToken,
    decision: "approved",
    mintPolicy: "approve",
    bindings: [{ app: "slack", connectionId }],
  });
  const claim = await t.mutation(
    internal.tables.slices.sliceRequestClaims.resolveSliceRequestClaim,
    { claimHandle: request.claimHandle },
  );
  expect(claim).toMatchObject({
    ok: true,
    kind: "slice",
    mintPolicy: "approve",
  });
  if (!claim.ok || claim.kind !== "slice") throw new Error("claim failed");
  expect(
    await t.mutation(
      internal.tables.slices.sliceRequestClaims.acknowledgeSliceClaim,
      { claimHandle: request.claimHandle, sliceSecret: claim.sliceSecret },
    ),
  ).toMatchObject({ ok: true, resourceStatus: "active" });
  const mint = await t.fetch("/api/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sliceToken: claim.sliceToken,
      sliceSecret: claim.sliceSecret,
      app: "slack",
    }),
  });
  expect(mint.status).toBe(202);
  await session.mutation(api.tables.slices.mutations.setMintPolicy, {
    sliceToken: claim.sliceToken,
    mintPolicy: "auto",
  });
  const currentSlice = await t.run((ctx) =>
    ctx.db.get("slices", claim.sliceId),
  );
  expect(currentSlice?.mintPolicy).toBe("auto");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    json(managedGrant("xoxe.xoxp-policy_changed")),
  );
  const issued = await t.fetch("/api/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sliceToken: claim.sliceToken,
      sliceSecret: claim.sliceSecret,
      app: "slack",
    }),
  });
  expect(issued.status).toBe(200);
  expect(await issued.json()).toMatchObject({
    accessToken: "xoxe.xoxp-policy_changed",
  });
  expect(
    await t.mutation(
      internal.tables.slices.sliceRequestClaims.acknowledgeSliceClaim,
      {
        claimHandle: request.claimHandle,
        sliceSecret: "wrong",
      },
    ),
  ).toMatchObject({ ok: false, status: 401, code: "UNAUTHORIZED" });
  expect(
    await t.mutation(
      internal.tables.slices.sliceRequestClaims.acknowledgeSliceClaim,
      {
        claimHandle: request.claimHandle,
        sliceSecret: claim.sliceSecret,
      },
    ),
  ).toMatchObject({ ok: true, resourceStatus: "active" });
  expect(
    await t.mutation(
      internal.tables.slices.sliceRequestClaims.resolveSliceRequestClaim,
      {
        claimHandle: request.claimHandle,
      },
    ),
  ).toMatchObject({
    ok: false,
    status: 409,
    code: "CLAIM_ALREADY_ACKNOWLEDGED",
  });
});

test("active lineages remain paginated and selectable past 100 historical and 100 live rows", async () => {
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  const oldestId = await t.run((ctx) =>
    ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "oldest",
      name: "Oldest",
      secretHash: "hash",
      status: "active",
    }),
  );
  await t.run(async (ctx) => {
    for (let i = 0; i < 110; i++) {
      await ctx.db.insert("agentConnections", {
        userId: id,
        agentId: `history-${i}`,
        name: `History ${i}`,
        secretHash: "hash",
        status: "revoked",
      });
    }
    for (let i = 0; i < 110; i++) {
      await ctx.db.insert("agentConnections", {
        userId: id,
        agentId: `live-${i}`,
        name: `Live ${i}`,
        secretHash: "hash",
        status: "active",
      });
    }
  });
  const first = await session.query(api.tables.agentDashboard.activePage, {
    paginationOpts: { numItems: 50, cursor: null },
  });
  expect(first.page).toHaveLength(50);
  expect(first.isDone).toBe(false);
  const second = await session.query(api.tables.agentDashboard.activePage, {
    paginationOpts: { numItems: 50, cursor: first.continueCursor },
  });
  const third = await session.query(api.tables.agentDashboard.activePage, {
    paginationOpts: { numItems: 50, cursor: second.continueCursor },
  });
  expect(
    [...first.page, ...second.page, ...third.page].some(
      (row) => row._id === oldestId,
    ),
  ).toBe(true);
  const options = await session.query(
    api.tables.agentConnections.replacementOptionsPage,
    { paginationOpts: { numItems: 150, cursor: null } },
  );
  expect(options.page.some((row) => row.id === oldestId)).toBe(true);
});

test("agent grants page reaches recent and older grants beyond 100", async () => {
  const t = convexTest(schema, modules);
  const { id, session } = await owner(t, "owner@example.com");
  const agentConnectionId = await t.run((ctx) =>
    ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "paged-agent",
      name: "Paged agent",
      secretHash: "hash",
      status: "active",
    }),
  );
  await t.run(async (ctx) => {
    for (let i = 0; i < 120; i++) {
      await ctx.db.insert("slices", {
        userId: id,
        agentId: "paged-agent",
        name: `Grant ${i}`,
        token: `page-token-${i}`,
        secretHash: "hash",
        status: "active",
        expiresAt: Date.now() + 60_000,
        mintPolicy: "auto",
      });
    }
  });
  const first = await session.query(api.tables.agentDashboard.grantsPage, {
    agentConnectionId,
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(first.page[0]?.name).toBe("Grant 119");
  const second = await session.query(api.tables.agentDashboard.grantsPage, {
    agentConnectionId,
    paginationOpts: { numItems: 110, cursor: first.continueCursor },
  });
  expect([...first.page, ...second.page]).toHaveLength(120);
  expect(second.page.at(-1)?.name).toBe("Grant 0");
});

test.each(["approved", "claimed"] as const)(
  "an unacknowledged %s slice is retired when its claim window expires",
  async (status) => {
    const t = convexTest(schema, modules);
    const { id } = await owner(t, "owner@example.com");
    const ids = await t.run(async (ctx) => {
      const sliceId = await ctx.db.insert("slices", {
        userId: id,
        agentId: "agent",
        name: "Slice",
        token: "token",
        secretHash: await sha256Hex("secret"),
        status: "staged",
        expiresAt: Date.now() + 60_000,
        mintPolicy: "auto",
      });
      const requestId = await ctx.db.insert("sliceRequests", {
        userId: id,
        agentId: "agent",
        publicToken: "public",
        claimSecretHash: "hash",
        status,
        approvalDeadlineAt: Date.now() - 1,
        pickupDeadlineAt: status === "approved" ? Date.now() - 1 : undefined,
        ackDeadlineAt: status === "claimed" ? Date.now() - 1 : undefined,
        apps: ["slack"],
        ttlMs: 60_000,
        reason: "test",
        createdSliceId: sliceId,
        issuedSliceSecretCipher: "cipher",
      });
      return { sliceId, requestId };
    });
    await t.mutation(
      internal.tables.slices.sliceRequestExpiry.clearClaimSecret,
      {
        requestId: ids.requestId,
      },
    );
    expect(
      (await t.run((ctx) => ctx.db.get("slices", ids.sliceId)))?.status,
    ).toBe("revoked");
    expect(
      (await t.run((ctx) => ctx.db.get("sliceRequests", ids.requestId)))
        ?.issuedSliceSecretCipher,
    ).toBe("");
  },
);

test("concurrent requests for one owner cannot exceed the pending allowance", async () => {
  const t = convexTest(schema, modules);
  const { id } = await owner(t, "owner@example.com");
  const secret = "agent-secret";
  const agentConnectionId = await t.run(async (ctx) => {
    for (let i = 0; i < 99; i++) {
      await ctx.db.insert("sliceRequests", {
        userId: id,
        agentId: "agent",
        publicToken: `pending-${i}`,
        claimSecretHash: `hash-${i}`,
        status: "pending",
        approvalDeadlineAt: Date.now() + 60_000,
        apps: ["slack"],
        ttlMs: 60_000,
        reason: "existing",
      });
    }
    return await ctx.db.insert("agentConnections", {
      userId: id,
      agentId: "agent",
      name: "Agent",
      status: "active",
      secretHash: await sha256Hex(secret),
    });
  });
  const create = (reason: string) =>
    t.mutation(internal.tables.slices.sliceRequestClaims.createSliceRequest, {
      agentConnectionId,
      agentConnectionSecret: secret,
      apps: ["slack"],
      ttlMs: 60_000,
      reason,
    });
  const results = await Promise.all([create("first"), create("second")]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toMatchObject([
    { code: "INVALID_REQUEST", status: 429 },
  ]);
});
