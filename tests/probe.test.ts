import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
const modules = import.meta.glob("../convex/**/*.ts");
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
    label: "A",
    connectorId: "connector",
    issuer: "https://scope.example",
  });
  await owner.mutation(api.probe.confirmAccount, {
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
    label: "B",
    connectorId: "connector",
    issuer: "https://scope.example",
  });
  await f.owner.mutation(api.probe.confirmAccount, {
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
