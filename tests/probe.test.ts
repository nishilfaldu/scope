import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { sha256Hex } from "../convex/lib/secrets";
const modules = import.meta.glob("../convex/**/*.ts");

test("existing Scope authentication derives ownership and rejects wrong or revoked credentials", async () => {
  const f = await fixture();
  const id = await f.t.run(async (ctx) =>
    ctx.db.insert("agentConnections", {
      userId: f.userId,
      agentId: "test-agent",
      name: "Test",
      secretHash: await sha256Hex("private-test-secret"),
      status: "active",
    }),
  );
  const args = {
    secret: f.actor.secret,
    connectionId: id,
    connectionSecret: "private-test-secret",
  };
  expect((await f.t.query(api.probe.existingAgent, args)).userId).toBe(
    f.userId,
  );
  await expect(
    f.t.query(api.probe.existingAgent, { ...args, connectionSecret: "wrong" }),
  ).rejects.toThrow("Unauthorized");
  await f.t.run((ctx) =>
    ctx.db.patch("agentConnections", id, { status: "revoked" }),
  );
  await expect(f.t.query(api.probe.existingAgent, args)).rejects.toThrow(
    "Unauthorized",
  );
});
beforeEach(() => vi.stubEnv("SCOPE_PROBE_SECRET", "probe-test-service-secret"));
async function fixture() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner@example.com" }),
  );
  const strangerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "stranger@example.com" }),
  );
  const owner = t.withIdentity({ subject: `${userId}|session` }),
    stranger = t.withIdentity({ subject: `${strangerId}|session` });
  const accountId = await owner.mutation(api.probe.addAccount, {
    secret: "probe-test-service-secret",
    label: "A",
    connectorId: "connector",
    issuer: "https://scope.example",
  });
  await owner.mutation(api.probe.confirmAccount, {
    secret: "probe-test-service-secret",
    id: accountId,
    installationId: "install-a",
    providerUserId: "usr-a",
  });
  const actor = {
    secret: "probe-test-service-secret",
    userId,
    requester: "workos-user:client:consent",
  };
  const args = {
    ...actor,
    accountId,
    key: "one-task-key-123456789",
    reason: "Read bases",
  };
  return { t, owner, stranger, userId, strangerId, accountId, actor, args };
}
test("request is bound to authenticated owner, agent and immutable account; retry reuses it", async () => {
  const f = await fixture();
  const r = await f.t.mutation(api.probe.request, f.args);
  expect((await f.t.mutation(api.probe.request, f.args)).id).toBe(r.id);
  await expect(
    f.t.mutation(api.probe.request, { ...f.args, reason: "Changed reason" }),
  ).rejects.toThrow("Idempotency conflict");
  await expect(
    f.t.mutation(api.probe.request, { ...f.args, userId: f.strangerId }),
  ).rejects.toThrow("Account unavailable");
  await expect(
    f.t.mutation(api.probe.request, { ...f.args, secret: "wrong" }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    f.stranger.mutation(api.probe.decide, { id: r.id, approve: true }),
  ).rejects.toThrow("Request unavailable");
  await expect(
    f.t.mutation(api.probe.claim, { ...f.actor, requester: "other", id: r.id }),
  ).rejects.toThrow("Request unavailable");
});
test("approval has one acquisition lease and lost delivery responses recover identical encrypted credentials", async () => {
  const f = await fixture();
  const r = await f.t.mutation(api.probe.request, f.args);
  expect(await f.t.mutation(api.probe.claim, { ...f.actor, id: r.id })).toEqual(
    { status: "pending" },
  );
  await f.owner.mutation(api.probe.decide, { id: r.id, approve: true });
  const claim = await f.t.mutation(api.probe.claim, { ...f.actor, id: r.id });
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: r.id })).status,
  ).toBe("acquiring");
  await f.t.mutation(api.probe.finalize, {
    ...f.actor,
    id: r.id,
    lease: claim.lease!,
    cipher: "cipher-only",
    fingerprint: "hash-a",
    expiresAt: Date.now() + 3600_000,
  });
  const first = await f.t.mutation(api.probe.claim, { ...f.actor, id: r.id });
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: r.id })).cipher,
  ).toBe(first.cipher);
  const dashboard = await f.owner.query(api.probe.dashboard, {});
  expect(JSON.stringify(dashboard)).not.toContain("cipher-only");
  expect(dashboard.credentials).toHaveLength(1);
  expect(dashboard.credentials[0].recipients).toEqual([f.actor.requester]);
});
test("revoking during acquisition blocks finalize and keeps prior history", async () => {
  const f = await fixture();
  const r = await f.t.mutation(api.probe.request, f.args);
  await f.owner.mutation(api.probe.decide, { id: r.id, approve: true });
  const c = await f.t.mutation(api.probe.claim, { ...f.actor, id: r.id });
  await f.owner.mutation(api.probe.revokeAccount, { id: f.accountId });
  await expect(
    f.t.mutation(api.probe.finalize, {
      ...f.actor,
      id: r.id,
      lease: c.lease!,
      cipher: "cipher",
      fingerprint: "hash",
      expiresAt: Date.now() + 3600_000,
    }),
  ).rejects.toThrow("Delivery unavailable");
  await expect(
    f.t.mutation(api.probe.claim, { ...f.actor, id: r.id }),
  ).rejects.toThrow("Account unavailable");
  expect((await f.owner.query(api.probe.dashboard, {})).requests).toHaveLength(
    1,
  );
});
test("denial and expiry never acquire a provider token", async () => {
  const f = await fixture();
  const r = await f.t.mutation(api.probe.request, f.args);
  await f.owner.mutation(api.probe.decide, { id: r.id, approve: false });
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: r.id })).status,
  ).toBe("denied");
  await f.t.run((ctx) =>
    ctx.db.patch("probeRequests", r.id, { expiresAt: Date.now() - 1 }),
  );
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: r.id })).status,
  ).toBe("expired");
});

test("two accounts use distinct subjects and approval for one never unlocks the other", async () => {
  const f = await fixture();
  const accountB = await f.owner.mutation(api.probe.addAccount, {
    secret: "probe-test-service-secret",
    label: "B",
    connectorId: "connector",
    issuer: "https://scope.example",
  });
  await f.owner.mutation(api.probe.confirmAccount, {
    secret: "probe-test-service-secret",
    id: accountB,
    installationId: "install-b",
    providerUserId: "usr-b",
  });
  const a = await f.owner.query(api.probe.account, { id: f.accountId });
  const b = await f.owner.query(api.probe.account, { id: accountB });
  expect(a.subjectId).not.toBe(b.subjectId);
  const ra = await f.t.mutation(api.probe.request, f.args);
  await expect(
    f.t.mutation(api.probe.request, { ...f.args, accountId: accountB }),
  ).rejects.toThrow("Idempotency conflict");
  const rb = await f.t.mutation(api.probe.request, {
    ...f.args,
    accountId: accountB,
    key: "different-task-key-123456",
  });
  await f.owner.mutation(api.probe.decide, { id: ra.id, approve: true });
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: ra.id })).account
      .providerUserId,
  ).toBe("usr-a");
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: rb.id })).status,
  ).toBe("pending");
  await f.owner.mutation(api.probe.revokeAccount, { id: f.accountId });
  await f.owner.mutation(api.probe.decide, { id: rb.id, approve: true });
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: rb.id })).account
      .providerUserId,
  ).toBe("usr-b");
});

test("the same provider token has one history entry across separately approved recipients", async () => {
  const f = await fixture();
  const actors = [
    f.actor,
    { ...f.actor, requester: "workos-user:other-client:other-consent" },
  ];
  for (const actor of actors) {
    const r = await f.t.mutation(api.probe.request, { ...f.args, ...actor });
    await f.owner.mutation(api.probe.decide, { id: r.id, approve: true });
    const status = await f.t.query(api.probe.agentStatus, {
      ...actor,
      id: r.id,
    });
    expect(status.status).toBe("approved");
    expect(
      (await f.owner.query(api.probe.dashboard, {})).credentials.length,
    ).toBe(actors.indexOf(actor) === 0 ? 0 : 1);
    const c = await f.t.mutation(api.probe.claim, { ...actor, id: r.id });
    await f.t.mutation(api.probe.finalize, {
      ...actor,
      id: r.id,
      lease: c.lease!,
      cipher: "encrypted-token",
      fingerprint: "same-provider-token",
      expiresAt: Date.now() + 3600_000,
    });
    await f.t.mutation(api.probe.claim, { ...actor, id: r.id });
  }
  const history = await f.owner.query(api.probe.dashboard, {});
  expect(history.credentials).toHaveLength(1);
  expect(new Set(history.credentials[0].recipients)).toEqual(
    new Set(actors.map((a) => a.requester)),
  );
  expect(JSON.stringify(history)).not.toContain("encrypted-token");
});

async function approved(f: Awaited<ReturnType<typeof fixture>>, args = f.args) {
  const request = await f.t.mutation(api.probe.request, args);
  await f.owner.mutation(api.probe.decide, { id: request.id, approve: true });
  const claim = await f.t.mutation(api.probe.claim, {
    secret: args.secret,
    userId: args.userId,
    requester: args.requester,
    id: request.id,
  });
  return { request, claim };
}

test("binding verification requires the server and cannot change an installation after approval", async () => {
  const f = await fixture();
  await expect(
    f.owner.mutation(api.probe.confirmAccount, {
      secret: "wrong",
      id: f.accountId,
      providerUserId: "usr-a",
      installationId: "install-a",
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    f.owner.mutation(api.probe.confirmAccount, {
      secret: f.actor.secret,
      id: f.accountId,
      providerUserId: "usr-a",
      installationId: "install-b",
    }),
  ).rejects.toThrow("Account identity changed");
});

test("revoked recipient is fenced after provider acquisition and before replay", async () => {
  const f = await fixture();
  const connectionId = await f.t.run((ctx) =>
    ctx.db.insert("agentConnections", {
      userId: f.userId,
      agentId: "live-agent",
      name: "Live agent",
      status: "active",
      secretHash: "hash",
    }),
  );
  const actor = {
    ...f.actor,
    requester: `scope-agent:live-agent:${connectionId}`,
  };
  const r = await f.t.mutation(api.probe.request, { ...f.args, ...actor });
  await f.owner.mutation(api.probe.decide, { id: r.id, approve: true });
  const c = await f.t.mutation(api.probe.claim, { ...actor, id: r.id });
  await f.t.run((ctx) =>
    ctx.db.patch("agentConnections", connectionId, { status: "revoked" }),
  );
  await expect(
    f.t.mutation(api.probe.finalize, {
      ...actor,
      id: r.id,
      lease: c.lease,
      cipher: "private",
      fingerprint: "same",
      expiresAt: Date.now() + 300_000,
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    f.t.mutation(api.probe.claim, { ...actor, id: r.id }),
  ).rejects.toThrow("Unauthorized");
});

test("receipt is authenticated, idempotent, and independent from attempted delivery", async () => {
  const f = await fixture();
  const { request, claim } = await approved(f);
  await f.t.mutation(api.probe.finalize, {
    ...f.actor,
    id: request.id,
    lease: claim.lease,
    cipher: "private-cipher",
    fingerprint: "f",
    expiresAt: Date.now() + 300_000,
  });
  const ready = await f.t.mutation(api.probe.claim, {
    ...f.actor,
    id: request.id,
  });
  const args = { ...f.actor, id: request.id, receiptId: ready.receiptId };
  await expect(
    f.t.mutation(api.probe.acknowledge, { ...args, requester: "another" }),
  ).rejects.toThrow("Receipt unavailable");
  await expect(
    f.t.mutation(api.probe.acknowledge, { ...args, receiptId: "wrong" }),
  ).rejects.toThrow("Receipt unavailable");
  expect(
    (await f.owner.query(api.probe.dashboard, {})).requests[0].receivedAt,
  ).toBeUndefined();
  await f.t.mutation(api.probe.acknowledge, args);
  const first = (await f.owner.query(api.probe.dashboard, {})).requests[0];
  await f.t.mutation(api.probe.claim, { ...f.actor, id: request.id });
  await f.t.mutation(api.probe.acknowledge, args);
  const second = (await f.owner.query(api.probe.dashboard, {})).requests[0];
  expect(second.receivedAt).toBe(first.receivedAt);
  expect(second.deliveredAt).toBe(first.deliveredAt);
  expect(second.deliveryAttempts).toBe(2);
  expect(JSON.stringify(second)).not.toContain("private-cipher");
  expect(JSON.stringify(second)).not.toContain(ready.receiptId);
});

test("the same token keeps one history row but each approval has its own fixed expiry", async () => {
  const f = await fixture();
  const expiryA = Date.now() + 120_000,
    expiryB = Date.now() + 300_000;
  const ids = [];
  for (const [key, expiresAt] of [
    ["request-for-token-A", expiryA],
    ["request-for-token-B", expiryB],
  ] as const) {
    const { request, claim } = await approved(f, { ...f.args, key });
    ids.push(request.id);
    await f.t.mutation(api.probe.finalize, {
      ...f.actor,
      id: request.id,
      lease: claim.lease,
      cipher: "same-token-cipher",
      fingerprint: "same-token",
      expiresAt,
    });
  }
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: ids[0] })).expiresAt,
  ).toBe(expiryA);
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: ids[1] })).expiresAt,
  ).toBe(expiryB);
  const dashboard = await f.owner.query(api.probe.dashboard, {});
  expect(dashboard.credentials).toHaveLength(1);
  const page = await f.owner.query(api.probe.credentialDeliveries, {
    id: dashboard.credentials[0].id,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(page.page).toHaveLength(1);
  expect(page.isDone).toBe(false);
  await expect(
    f.stranger.query(api.probe.credentialDeliveries, {
      id: dashboard.credentials[0].id,
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("Credential unavailable");
});

test("cancel during acquisition and expired cleanup preserve history without credential delivery", async () => {
  const f = await fixture();
  const { request, claim } = await approved(f);
  await f.owner.mutation(api.probe.cancel, { id: request.id });
  await expect(
    f.t.mutation(api.probe.finalize, {
      ...f.actor,
      id: request.id,
      lease: claim.lease,
      cipher: "private",
      fingerprint: "x",
      expiresAt: Date.now() + 300_000,
    }),
  ).rejects.toThrow("Delivery unavailable");
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: request.id }))
      .status,
  ).toBe("cancelled");
  const next = await approved(f, { ...f.args, key: "another-request-key-123" });
  await f.t.mutation(api.probe.finalize, {
    ...f.actor,
    id: next.request.id,
    lease: next.claim.lease,
    cipher: "erase-me",
    fingerprint: "y",
    expiresAt: Date.now() + 300_000,
  });
  await f.t.run((ctx) =>
    ctx.db.patch("probeRequests", next.request.id, {
      cleanupAt: Date.now() - 1,
    }),
  );
  await f.t.mutation(internal.probe.clearDelivery, { id: next.request.id });
  const row = await f.t.run((ctx) =>
    ctx.db.get("probeRequests", next.request.id),
  );
  expect(row?.deliveryCipher).toBeUndefined();
  expect(row?.credentialId).toBeDefined();
});

test("durable push retries reuse one job; stale attempts and expired subscriptions are fenced", async () => {
  vi.useFakeTimers();
  try {
    const f = await fixture();
    await f.owner.mutation(api.probe.subscribe, {
      endpoint: "https://fcm.googleapis.com/test",
      p256dh: "synthetic",
      auth: "synthetic",
    });
    const r = await f.t.mutation(api.probe.request, f.args);
    await f.t.mutation(api.probe.request, f.args);
    const jobs = await f.t.run((ctx) =>
      ctx.db
        .query("probeNotifications")
        .withIndex("by_request", (q) => q.eq("requestId", r.id))
        .collect(),
    );
    expect(jobs).toHaveLength(1);
    const first = await f.t.mutation(internal.probe.beginNotification, {
      id: jobs[0]._id,
    });
    expect(
      await f.t.mutation(internal.probe.beginNotification, { id: jobs[0]._id }),
    ).toBeNull();
    await f.t.mutation(internal.probe.finishNotification, {
      id: jobs[0]._id,
      lease: first.lease,
      outcome: "retry",
    });
    // Advance wall time without executing the scheduled external network action.
    vi.setSystemTime(Date.now() + 60_000);
    const second = await f.t.mutation(internal.probe.beginNotification, {
      id: jobs[0]._id,
    });
    expect(second.lease).not.toBe(first.lease);
    await f.t.mutation(internal.probe.finishNotification, {
      id: jobs[0]._id,
      lease: first.lease,
      outcome: "sent",
    });
    expect(
      (await f.t.run((ctx) => ctx.db.get("probeNotifications", jobs[0]._id)))
        ?.status,
    ).toBe("pending");
    await f.t.mutation(internal.probe.finishNotification, {
      id: jobs[0]._id,
      lease: second.lease,
      outcome: "gone",
    });
    expect(
      (await f.t.run((ctx) => ctx.db.get("probeNotifications", jobs[0]._id)))
        ?.status,
    ).toBe("failed");
    expect(
      await f.t.query(api.probe.subscriptions, {
        secret: f.actor.secret,
        userId: f.userId,
      }),
    ).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test("separate PAT connectors stay bound to their approvals and authenticated recipients", async () => {
  const f = await fixture();
  const a = await f.owner.mutation(api.probe.addAccount, {
    secret: f.actor.secret,
    label: "PAT A",
    connectorId: "scl_A",
    issuer: "https://scope.example",
    credentialKind: "shared-pat",
    baseId: "appBaseA",
  });
  const b = await f.owner.mutation(api.probe.addAccount, {
    secret: f.actor.secret,
    label: "PAT B",
    connectorId: "scl_B",
    issuer: "https://scope.example",
    credentialKind: "shared-pat",
    baseId: "appBaseB",
  });
  for (const [id, providerUserId] of [
    [a, "usrA"],
    [b, "usrB"],
  ] as const)
    await f.owner.mutation(api.probe.confirmAccount, {
      secret: f.actor.secret,
      id,
      providerUserId,
    });
  const recipientB = { ...f.actor, requester: "other-authenticated-recipient" };
  const requestA = await f.t.mutation(api.probe.request, {
    ...f.args,
    accountId: a,
  });
  const requestB = await f.t.mutation(api.probe.request, {
    ...f.args,
    ...recipientB,
    accountId: b,
    key: "separate-pat-B-request",
  });
  await f.owner.mutation(api.probe.decide, { id: requestA.id, approve: true });
  await expect(
    f.t.mutation(api.probe.claim, { ...recipientB, id: requestA.id }),
  ).rejects.toThrow("Request unavailable");
  const claimA = await f.t.mutation(api.probe.claim, {
    ...f.actor,
    id: requestA.id,
  });
  expect(claimA.account).toMatchObject({
    connectorId: "scl_A",
    baseId: "appBaseA",
    providerUserId: "usrA",
  });
  expect(
    await f.t.mutation(api.probe.claim, { ...recipientB, id: requestB.id }),
  ).toEqual({ status: "pending" });
  await f.t.mutation(api.probe.finalize, {
    ...f.actor,
    id: requestA.id,
    lease: claimA.lease,
    cipher: "private-A",
    fingerprint: "fingerprint-A",
    expiresAt: Date.now() + 300_000,
  });
  await f.owner.mutation(api.probe.decide, { id: requestB.id, approve: true });
  const claimB = await f.t.mutation(api.probe.claim, {
    ...recipientB,
    id: requestB.id,
  });
  expect(claimB.account).toMatchObject({
    connectorId: "scl_B",
    baseId: "appBaseB",
    providerUserId: "usrB",
  });
  await expect(
    f.t.mutation(api.probe.claim, { ...f.actor, id: requestB.id }),
  ).rejects.toThrow("Request unavailable");
  expect(
    (await f.t.mutation(api.probe.claim, { ...f.actor, id: requestA.id }))
      .cipher,
  ).toBe("private-A");
});

test("notification detail reads only the owner's request and excludes delivery secrets", async () => {
  const f = await fixture();
  const created = await f.t.mutation(api.probe.request, f.args);
  await f.t.run((ctx) =>
    ctx.db.patch("probeRequests", created.id, {
      deliveryCipher: "private-cipher",
      receiptId: "private-receipt",
      lease: "private-lease",
    }),
  );
  const detail = await f.owner.query(api.probe.requestForOwner, {
    reference: created.id,
  });
  expect(detail?.request._id).toBe(created.id);
  expect(detail?.account?.providerUserId).toBe("usr-a");
  expect(JSON.stringify(detail)).not.toContain("private-");
  expect(detail?.account).not.toHaveProperty("subjectId");
  expect(
    await f.stranger.query(api.probe.requestForOwner, {
      reference: created.id,
    }),
  ).toBeNull();
  expect(
    await f.owner.query(api.probe.requestForOwner, {
      reference: "bad-url-reference",
    }),
  ).toBeNull();
  await expect(
    f.t.query(api.probe.requestForOwner, { reference: created.id }),
  ).rejects.toThrow("Sign in required");
});
