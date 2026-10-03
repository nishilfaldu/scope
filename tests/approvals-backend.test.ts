import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
const modules = import.meta.glob("../convex/**/*.ts");
const secret = "service-test-secret";
const { sendPush } = vi.hoisted(() => ({ sendPush: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: sendPush } }));
beforeEach(() => {
  vi.stubEnv("SCOPE_SERVICE_SECRET", secret);
  vi.stubEnv("SCOPE_HELPER_CLIENT_ID", "helper-client");
  vi.stubEnv("SCOPE_VAPID_PUBLIC_KEY", "synthetic-public");
  vi.stubEnv("SCOPE_VAPID_PRIVATE_KEY", "synthetic-private");
  sendPush.mockReset();
  sendPush.mockResolvedValue({ statusCode: 201 });
});
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
  const helper = {
    secret,
    userId,
    issuer: "https://workos.example",
    subject: `scope:${userId}`,
    clientId: "helper-client",
    consentId: "helper-consent",
  };
  const native = {
    ...helper,
    clientId: "native-client",
    consentId: "native-consent",
  };
  const helperConnection = await t.mutation(
    api.clientConnections.ensure,
    helper,
  );
  const nativeConnection = await t.mutation(
    api.clientConnections.ensure,
    native,
  );
  const accountId = await t.run((ctx) =>
    ctx.db.insert("connectedAccounts", {
      ownerId: userId,
      integrationId: "airtable-rest-read",
      label: "Account A",
      providerName: "Airtable",
      accessDescription: "Read the bases granted during Airtable sign-in.",
      providerUserId: "usr-a",
      connect: {
        connectorId: "oauth",
        subjectId: "grant-a",
        issuer: "https://convex.example",
      },
      grantedScopes: ["schema.bases:read"],
      profileId: "bases.read",
      profileVersion: 1,
      grantVersion: 1,
      state: "active",
    }),
  );
  const requestArgs = {
    ...native,
    accountId,
    collectorConnectionId: helperConnection._id,
    key: "one-task-key-123456789",
    reason: "Read the available bases",
    intent: "Find the project base",
  };
  async function request(approve = true, overrides = {}) {
    const r = await t.mutation(api.approvals.request, {
      ...requestArgs,
      ...overrides,
    });
    await owner.mutation(api.approvals.decide, { id: r.id, approve });
    return r;
  }
  function delivery(id: Id<"approvalRequests">) {
    return {
      ...helper,
      id,
      grantVersion: 1,
      profileId: "bases.read",
      profileVersion: 1,
    };
  }
  function preflight(id: Id<"approvalRequests">) {
    return t.query(api.approvals.preflight, { ...helper, id, now: Date.now() });
  }
  return {
    t,
    owner,
    stranger,
    userId,
    strangerId,
    helper,
    native,
    helperConnection,
    nativeConnection,
    accountId,
    requestArgs,
    request,
    delivery,
    preflight,
  };
}
test("service authentication, existing Standalone owner and exact principal tuple are required", async () => {
  const f = await fixture();
  for (const change of [
    { secret: "wrong" },
    { subject: "external-user" },
    { consentId: "" },
    { userId: f.strangerId },
  ])
    await expect(
      f.t.mutation(api.clientConnections.ensure, { ...f.helper, ...change }),
    ).rejects.toThrow("Unauthorized");
  expect(await f.t.mutation(api.clientConnections.ensure, f.helper)).toEqual(
    f.helperConnection,
  );
  const consent2 = await f.t.mutation(api.clientConnections.ensure, {
    ...f.helper,
    consentId: "new-consent",
  });
  const issuer2 = await f.t.mutation(api.clientConnections.ensure, {
    ...f.helper,
    issuer: "https://other.workos.example",
  });
  expect(consent2._id).not.toBe(f.helperConnection._id);
  expect(issuer2._id).not.toBe(f.helperConnection._id);
  expect(f.nativeConnection.collectorEligible).toBe(false);
});
test("collector eligibility comes from server configuration and exact selected connection", async () => {
  const f = await fixture();
  await expect(
    f.t.mutation(api.approvals.request, {
      ...f.requestArgs,
      collectorConnectionId: f.nativeConnection._id,
    }),
  ).rejects.toThrow("Collector unavailable");
  const stranger = {
    ...f.helper,
    userId: f.strangerId,
    subject: `scope:${f.strangerId}`,
  };
  const other = await f.t.mutation(api.clientConnections.ensure, stranger);
  await expect(
    f.t.mutation(api.approvals.request, {
      ...f.requestArgs,
      collectorConnectionId: other._id,
    }),
  ).rejects.toThrow("Collector unavailable");
  const r = await f.request();
  await expect(
    f.t.query(api.approvals.preflight, {
      ...f.native,
      id: r.id,
      now: Date.now(),
    }),
  ).rejects.toThrow("Request unavailable");
  const otherHelper = { ...f.helper, consentId: "another-owned-helper" };
  await f.t.mutation(api.clientConnections.ensure, otherHelper);
  await expect(
    f.t.query(api.approvals.preflight, {
      ...otherHelper,
      id: r.id,
      now: Date.now(),
    }),
  ).rejects.toThrow("Request unavailable");
  expect((await f.preflight(r.id)).status).toBe("acquire");
  vi.stubEnv("SCOPE_HELPER_CLIENT_ID", "changed-client");
  await expect(f.preflight(r.id)).rejects.toThrow("Request unavailable");
});
test("a local helper can request for itself without an owner-wide delivery permission", async () => {
  const f = await fixture();
  const r = await f.t.mutation(api.approvals.request, {
    ...f.helper,
    accountId: f.accountId,
    key: "helper-local-key-123456",
    reason: "Read bases",
  });
  const status = await f.t.query(api.approvals.status, {
    ...f.helper,
    id: r.id,
  });
  expect(status.requesterConnectionId).toBe(f.helperConnection._id);
  expect(status.collectorConnectionId).toBe(f.helperConnection._id);
});
test("idempotent retries preserve original deadline and reject changed account, collector and context", async () => {
  const f = await fixture(),
    r = await f.request();
  const retries = await Promise.all([
    f.t.mutation(api.approvals.request, f.requestArgs),
    f.t.mutation(api.approvals.request, f.requestArgs),
  ]);
  for (const retry of retries)
    expect(retry).toMatchObject({
      id: r.id,
      approvalExpiresAt: r.approvalExpiresAt,
      created: false,
    });
  const other = await f.t.mutation(api.clientConnections.ensure, {
    ...f.helper,
    consentId: "other-consent",
  });
  for (const change of [
    { reason: "Another task" },
    { intent: "Changed intent" },
    { collectorConnectionId: other._id },
  ])
    await expect(
      f.t.mutation(api.approvals.request, { ...f.requestArgs, ...change }),
    ).rejects.toThrow("Idempotency conflict");
});
test("approval for one grant never unlocks a second authorization of the same provider identity", async () => {
  const f = await fixture();
  const a = await f.t.run((ctx) =>
    ctx.db.get("connectedAccounts", f.accountId),
  );
  const { _id: unusedId, _creationTime: unusedTime, ...values } = a!;
  void unusedId;
  void unusedTime;
  const b = await f.t.run((ctx) =>
    ctx.db.insert("connectedAccounts", {
      ...values,
      connect: { ...values.connect, subjectId: "separate-grant-same-identity" },
      label: "Account B",
    }),
  );
  const ra = await f.request();
  await expect(
    f.t.mutation(api.approvals.request, { ...f.requestArgs, accountId: b }),
  ).rejects.toThrow("Idempotency conflict");
  const rb = await f.t.mutation(api.approvals.request, {
    ...f.requestArgs,
    accountId: b,
    key: "other-grant-key-123456",
  });
  const pa = await f.preflight(ra.id);
  expect(pa.status === "acquire" && pa.account.subjectId).toBe("grant-a");
  expect(await f.preflight(rb.id)).toEqual({ status: "pending" });
  await f.owner.mutation(api.accounts.block, { id: f.accountId });
  await f.owner.mutation(api.approvals.decide, { id: rb.id, approve: true });
  const pb = await f.preflight(rb.id);
  expect(pb.status === "acquire" && pb.account.subjectId).toBe(
    "separate-grant-same-identity",
  );
});
test("denial, pending and expiry never authorize delivery", async () => {
  const f = await fixture(),
    denied = await f.request(false);
  expect(await f.preflight(denied.id)).toEqual({ status: "denied" });
  await expect(
    f.t.mutation(api.approvals.authorizeDelivery, f.delivery(denied.id)),
  ).rejects.toThrow("Delivery unavailable");
  const pending = await f.t.mutation(api.approvals.request, {
    ...f.requestArgs,
    key: "pending-task-key-123456",
  });
  expect(await f.preflight(pending.id)).toEqual({ status: "pending" });
  await f.t.run((ctx) =>
    ctx.db.patch("approvalRequests", pending.id, {
      approvalExpiresAt: Date.now() - 1,
    }),
  );
  expect(await f.preflight(pending.id)).toEqual({ status: "expired" });
  await expect(
    f.owner.mutation(api.approvals.decide, { id: pending.id, approve: true }),
  ).rejects.toThrow("Request unavailable");
});
test("delivery retries record attempts with stable proof and deadline, never provider credentials", async () => {
  const f = await fixture(),
    r = await f.request();
  const first = await f.t.mutation(api.approvals.authorizeDelivery, {
    ...f.delivery(r.id),
    tokenId: "rotated-one",
    providerExpiresAt: Date.now() + 120_000,
  });
  const second = await f.t.mutation(api.approvals.authorizeDelivery, {
    ...f.delivery(r.id),
    tokenId: "rotated-two",
    providerExpiresAt: Date.now() + 3600_000,
  });
  expect(second).toEqual(first);
  expect(first.approvalExpiresAt).toBe(r.approvalExpiresAt);
  const row = await f.t.run((ctx) => ctx.db.get("approvalRequests", r.id));
  expect(row?.deliveryAttempts).toBe(2);
  expect(row?.tokenId).toBe("rotated-two");
  expect(row?.providerExpiresAt).toBeGreaterThan(r.approvalExpiresAt);
  for (const forbidden of [
    "accessToken",
    "refreshToken",
    "cipher",
    "fingerprint",
    "lease",
    "credentialId",
  ])
    expect(row).not.toHaveProperty(forbidden);
  await expect(
    f.t.mutation(api.approvals.authorizeDelivery, {
      ...f.delivery(r.id),
      profileVersion: 2,
    }),
  ).rejects.toThrow("Delivery unavailable");
  await expect(
    f.t.mutation(api.approvals.authorizeDelivery, {
      ...f.delivery(r.id),
      providerExpiresAt: Date.now() - 1,
    }),
  ).rejects.toThrow("Delivery unavailable");
});
for (const change of [
  "cancel",
  "requester-stop",
  "collector-stop",
  "disconnect",
  "reconnect",
  "profile-change",
  "expiry",
] as const)
  test(`${change} winning during provider acquisition prevents final release`, async () => {
    const f = await fixture(),
      r = await f.request();
    expect((await f.preflight(r.id)).status).toBe("acquire");
    if (change === "cancel")
      await f.owner.mutation(api.approvals.cancel, { id: r.id });
    if (change === "requester-stop")
      await f.owner.mutation(api.clientConnections.update, {
        id: f.nativeConnection._id,
        stop: true,
      });
    if (change === "collector-stop")
      await f.owner.mutation(api.clientConnections.update, {
        id: f.helperConnection._id,
        stop: true,
      });
    if (change === "disconnect")
      await f.owner.mutation(api.accounts.block, { id: f.accountId });
    if (change === "reconnect")
      await f.t.run((ctx) =>
        ctx.db.patch("connectedAccounts", f.accountId, {
          grantVersion: 2,
          connect: {
            connectorId: "oauth",
            subjectId: "replacement-grant",
            issuer: "https://convex.example",
          },
        }),
      );
    if (change === "profile-change")
      await f.t.run((ctx) =>
        ctx.db.patch("connectedAccounts", f.accountId, { profileVersion: 2 }),
      );
    if (change === "expiry")
      await f.t.run((ctx) =>
        ctx.db.patch("approvalRequests", r.id, {
          approvalExpiresAt: Date.now() - 1,
        }),
      );
    await expect(
      f.t.mutation(api.approvals.authorizeDelivery, f.delivery(r.id)),
    ).rejects.toThrow();
    expect(
      (await f.t.run((ctx) => ctx.db.get("approvalRequests", r.id)))
        ?.deliveryAttempts,
    ).toBeUndefined();
  });
test("receipt is exact-collector authenticated, idempotent and historical after cancellation and expiry", async () => {
  const f = await fixture(),
    r = await f.request();
  const delivered = await f.t.mutation(
    api.approvals.authorizeDelivery,
    f.delivery(r.id),
  );
  const args = { ...f.helper, id: r.id, receiptProof: delivered.receiptProof };
  await expect(
    f.t.mutation(api.approvals.acknowledge, { ...args, ...f.native }),
  ).rejects.toThrow("Receipt unavailable");
  await expect(
    f.t.mutation(api.approvals.acknowledge, { ...args, receiptProof: "wrong" }),
  ).rejects.toThrow("Receipt unavailable");
  const before = await f.owner.query(api.approvals.requestForOwner, {
    reference: r.id,
  });
  expect(before?.deliveredAt).toBeDefined();
  expect(before?.receivedAt).toBeUndefined();
  await f.owner.mutation(api.approvals.cancel, { id: r.id });
  await f.t.run((ctx) =>
    ctx.db.patch("approvalRequests", r.id, {
      approvalExpiresAt: Date.now() - 1,
    }),
  );
  await f.t.mutation(api.approvals.acknowledge, args);
  const first = await f.owner.query(api.approvals.requestForOwner, {
    reference: r.id,
  });
  await f.t.mutation(api.approvals.acknowledge, args);
  expect(
    (await f.owner.query(api.approvals.requestForOwner, { reference: r.id }))
      ?.receivedAt,
  ).toBe(first?.receivedAt);
  expect(first?.status).toBe("cancelled");
  expect(first?.deliveredAt).toBe(before?.deliveredAt);
  expect(JSON.stringify(first)).not.toContain(delivered.receiptProof);
  const status = await f.t.query(api.approvals.status, {
    ...f.helper,
    id: r.id,
  });
  expect(JSON.stringify(status)).not.toContain(delivered.receiptProof);
  expect(status).not.toHaveProperty("tokenId");
});
test("owner decisions and history enforce ownership and never expose Connect references or receipt secrets", async () => {
  const f = await fixture(),
    r = await f.request();
  const released = await f.t.mutation(
    api.approvals.authorizeDelivery,
    f.delivery(r.id),
  );
  await expect(
    f.stranger.mutation(api.approvals.decide, { id: r.id, approve: true }),
  ).rejects.toThrow("Request unavailable");
  await expect(
    f.stranger.mutation(api.approvals.cancel, { id: r.id }),
  ).rejects.toThrow("Request unavailable");
  expect(
    await f.stranger.query(api.approvals.requestForOwner, { reference: r.id }),
  ).toBeNull();
  expect(
    await f.owner.query(api.approvals.requestForOwner, {
      reference: "untrusted-url-fragment",
    }),
  ).toBeNull();
  await expect(
    f.t.query(api.approvals.requestForOwner, { reference: r.id }),
  ).rejects.toThrow("Sign in required");
  for (const result of [
    await f.owner.query(api.approvals.forOwner, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
    await f.owner.query(api.approvals.retainedForOwner, { ids: [r.id] }),
    await f.owner.query(api.accounts.forOwner, {}),
  ]) {
    const json = JSON.stringify(result);
    expect(json).not.toContain(released.receiptProof);
    expect(json).not.toContain("grant-a");
    expect(json).not.toContain("oauth");
  }
  expect(
    (
      await f.stranger.query(api.approvals.forOwner, {
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).page,
  ).toEqual([]);
  expect(
    await f.stranger.query(api.approvals.retainedForOwner, { ids: [r.id] }),
  ).toEqual([]);
});
test("account and client renames do not change the immutable approval display and permission snapshot", async () => {
  const f = await fixture(),
    r = await f.request();
  await f.owner.mutation(api.clientConnections.update, {
    id: f.nativeConnection._id,
    name: "Renamed requester",
  });
  await f.owner.mutation(api.clientConnections.update, {
    id: f.helperConnection._id,
    name: "Renamed helper",
  });
  await f.t.run((ctx) =>
    ctx.db.patch("connectedAccounts", f.accountId, {
      label: "Renamed account",
      providerName: "New name",
      accessDescription: "Changed permission description",
    }),
  );
  const detail = await f.owner.query(api.approvals.requestForOwner, {
    reference: r.id,
  });
  expect(detail?.snapshot).toMatchObject({
    accountLabel: "Account A",
    providerName: "Airtable",
    accessDescription: "Read the bases granted during Airtable sign-in.",
    requesterName: "MCP connection",
    collectorName: "Local helper",
  });
  expect((await f.preflight(r.id)).status).toBe("acquire");
  await expect(
    f.stranger.mutation(api.clientConnections.update, {
      id: f.nativeConnection._id,
      name: "Impersonator",
    }),
  ).rejects.toThrow("Connection unavailable");
});
test("older pending decisions remain discoverable behind paginated completed history", async () => {
  const f = await fixture(),
    first = await f.t.mutation(api.approvals.request, f.requestArgs);
  for (let i = 0; i < 25; i++)
    await f.request(false, { key: `completed-request-key-${i}` });
  const page = await f.owner.query(api.approvals.forOwner, {
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(page.page.some((r) => r._id === first.id)).toBe(false);
  expect(page.isDone).toBe(false);
  const next = await f.owner.query(api.approvals.forOwner, {
    paginationOpts: { numItems: 20, cursor: page.continueCursor },
  });
  expect(next.page.some((r) => r._id === first.id)).toBe(true);
  expect(
    (
      await f.owner.query(api.approvals.pendingForOwner, { now: Date.now() })
    ).map((r) => r._id),
  ).toEqual([first.id]);
  expect(
    await f.stranger.query(api.approvals.pendingForOwner, { now: Date.now() }),
  ).toEqual([]);
});
test("stopping a client is immediate, irreversible and records stable time", async () => {
  const f = await fixture(),
    r = await f.request();
  await f.owner.mutation(api.clientConnections.update, {
    id: f.nativeConnection._id,
    stop: true,
  });
  const before = await f.owner.query(api.approvals.requestForOwner, {
    reference: r.id,
  });
  await f.owner.mutation(api.clientConnections.update, {
    id: f.nativeConnection._id,
    stop: false,
  });
  expect(
    (await f.owner.query(api.approvals.requestForOwner, { reference: r.id }))
      ?.requesterStoppedAt,
  ).toBe(before?.requesterStoppedAt);
  await expect(
    f.t.mutation(api.clientConnections.ensure, f.native),
  ).rejects.toThrow("Connection unavailable");
  expect((await f.preflight(r.id)).status).toBe("unavailable");
});

async function attempt(
  f: Awaited<ReturnType<typeof fixture>>,
  targetAccountId?: Id<"connectedAccounts">,
) {
  return f.owner.mutation(api.accounts.beginConnection, {
    secret,
    integrationId: "airtable-rest-read",
    providerName: "Airtable",
    accessDescription: "Read the bases granted during Airtable sign-in.",
    connectorId: "oauth",
    issuer: "https://convex.example",
    profileId: "bases.read",
    profileVersion: 1,
    proofHash: "a".repeat(64),
    targetAccountId,
  });
}
function completion(id: Id<"connectionAttempts">, providerUserId = "usr-new") {
  return {
    secret,
    id,
    proofHash: "a".repeat(64),
    providerUserId,
    label: "New grant",
    grantedScopes: ["schema.bases:read"],
  };
}
test("OAuth attempts add no account until owner, browser proof and verified identity agree; installation is optional", async () => {
  const f = await fixture(),
    a = await attempt(f),
    args = completion(a.id);
  expect(await f.owner.query(api.accounts.forOwner, {})).toHaveLength(1);
  for (const caller of [f.t, f.stranger])
    await expect(
      caller.mutation(api.accounts.completeConnection, args),
    ).rejects.toThrow();
  for (const change of [
    { proofHash: "b".repeat(64) },
    { installationId: "*" },
    { providerUserId: "" },
    { secret: "wrong" },
  ])
    await expect(
      f.owner.mutation(api.accounts.completeConnection, { ...args, ...change }),
    ).rejects.toThrow();
  const completed = await f.owner.mutation(
    api.accounts.completeConnection,
    args,
  );
  expect(await f.owner.mutation(api.accounts.completeConnection, args)).toEqual(
    completed,
  );
  expect(completed.superseded).toBeUndefined();
  expect(await f.owner.query(api.accounts.forOwner, {})).toHaveLength(2);
  const stored = await f.t.run((ctx) =>
    ctx.db.get("connectedAccounts", completed.accountId),
  );
  expect(stored?.connect.installationId).toBeUndefined();
  expect(stored?.connect.subjectId).toBe(a.subjectId);
  await expect(
    f.owner.mutation(api.accounts.completeConnection, {
      ...args,
      providerUserId: "other-user",
    }),
  ).rejects.toThrow("Account identity changed");
});
test("separate authorizations of one provider identity stay separate; reconnect increments version and fences old requests", async () => {
  const f = await fixture(),
    r = await f.request();
  const added = await attempt(f),
    other = await f.owner.mutation(
      api.accounts.completeConnection,
      completion(added.id, "usr-a"),
    );
  expect(other.accountId).not.toBe(f.accountId);
  const reconnect = await attempt(f, f.accountId);
  await expect(
    f.owner.mutation(
      api.accounts.completeConnection,
      completion(reconnect.id, "wrong-identity"),
    ),
  ).rejects.toThrow("Account identity changed");
  const replaced = await f.owner.mutation(
    api.accounts.completeConnection,
    completion(reconnect.id, "usr-a"),
  );
  expect(replaced.accountId).toBe(f.accountId);
  expect(replaced.superseded?.connect.subjectId).toBe("grant-a");
  expect(
    (
      await f.owner.mutation(
        api.accounts.completeConnection,
        completion(reconnect.id, "usr-a"),
      )
    ).superseded,
  ).toEqual(replaced.superseded);
  const account = await f.t.run((ctx) =>
    ctx.db.get("connectedAccounts", f.accountId),
  );
  expect(account?.grantVersion).toBe(2);
  expect(account?.connect.subjectId).toBe(reconnect.subjectId);
  expect((await f.preflight(r.id)).status).toBe("unavailable");
  await expect(
    f.t.mutation(api.approvals.authorizeDelivery, f.delivery(r.id)),
  ).rejects.toThrow("Delivery unavailable");
  const otherRequest = await f.request(true, {
    accountId: other.accountId,
    key: "other-account-task-123456",
  });
  expect((await f.preflight(otherRequest.id)).status).toBe("acquire");
});
test("competing reconnect completions cannot overwrite a replacement and expired attempts are deleted", async () => {
  const f = await fixture(),
    a = await attempt(f, f.accountId),
    b = await attempt(f, f.accountId);
  await f.owner.mutation(
    api.accounts.completeConnection,
    completion(a.id, "usr-a"),
  );
  await expect(
    f.owner.mutation(
      api.accounts.completeConnection,
      completion(b.id, "usr-a"),
    ),
  ).rejects.toThrow("Account identity changed");
  await f.t.run((ctx) =>
    ctx.db.patch("connectionAttempts", b.id, { expiresAt: Date.now() - 1 }),
  );
  await expect(
    f.owner.mutation(
      api.accounts.completeConnection,
      completion(b.id, "usr-a"),
    ),
  ).rejects.toThrow("Connection unavailable");
  await f.t.mutation(internal.accounts.expireAttempt, { id: b.id });
  expect(
    await f.t.run((ctx) => ctx.db.get("connectionAttempts", b.id)),
  ).toBeNull();
  await f.t.mutation(internal.accounts.expireAttempt, { id: a.id });
  expect(
    await f.t.run((ctx) => ctx.db.get("connectionAttempts", a.id)),
  ).not.toBeNull();
});
test("disconnect outcomes are separate from immediate block and cannot overwrite a reconnected account", async () => {
  const f = await fixture(),
    block = await f.owner.mutation(api.accounts.block, { id: f.accountId });
  await f.owner.mutation(api.accounts.recordDisconnect, {
    secret,
    id: f.accountId,
    grantVersion: block.grantVersion,
    outcome: "failed",
  });
  expect((await f.owner.query(api.accounts.forOwner, {}))[0]).toMatchObject({
    state: "blocked",
    disconnectOutcome: "failed",
  });
  await expect(
    f.stranger.mutation(api.accounts.block, { id: f.accountId }),
  ).rejects.toThrow("Account unavailable");
  const reconnect = await attempt(f, f.accountId);
  await f.owner.mutation(
    api.accounts.completeConnection,
    completion(reconnect.id, "usr-a"),
  );
  await expect(
    f.owner.mutation(api.accounts.recordDisconnect, {
      secret,
      id: f.accountId,
      grantVersion: block.grantVersion,
      outcome: "succeeded",
    }),
  ).rejects.toThrow("Account unavailable");
});
test("durable push retries reuse one job; stale attempts, provider changes and gone subscriptions are fenced", async () => {
  vi.useFakeTimers();
  try {
    const f = await fixture();
    await f.owner.mutation(api.notifications.subscribe, {
      endpoint: "https://fcm.googleapis.com/test",
      p256dh: "synthetic",
      auth: "synthetic",
    });
    const r = await f.t.mutation(api.approvals.request, f.requestArgs);
    await f.t.mutation(api.approvals.request, f.requestArgs);
    const jobs = await f.t.run((ctx) =>
      ctx.db
        .query("notificationJobs")
        .withIndex("by_requestId", (q) => q.eq("requestId", r.id))
        .take(10),
    );
    expect(jobs).toHaveLength(1);
    const first = await f.t.mutation(internal.notifications.beginDelivery, {
      id: jobs[0]._id,
    });
    expect(
      await f.t.mutation(internal.notifications.beginDelivery, {
        id: jobs[0]._id,
      }),
    ).toBeNull();
    await f.t.mutation(internal.notifications.finishDelivery, {
      id: jobs[0]._id,
      lease: first!.lease,
      outcome: "retry",
    });
    vi.setSystemTime(Date.now() + 60_000);
    const second = await f.t.mutation(internal.notifications.beginDelivery, {
      id: jobs[0]._id,
    });
    expect(second?.lease).not.toBe(first?.lease);
    await f.t.mutation(internal.notifications.finishDelivery, {
      id: jobs[0]._id,
      lease: first!.lease,
      outcome: "sent",
    });
    expect(
      (await f.t.run((ctx) => ctx.db.get("notificationJobs", jobs[0]._id)))
        ?.status,
    ).toBe("pending");
    await f.t.mutation(internal.notifications.finishDelivery, {
      id: jobs[0]._id,
      lease: second!.lease,
      outcome: "gone",
    });
    expect(
      (await f.t.run((ctx) => ctx.db.get("notificationJobs", jobs[0]._id)))
        ?.status,
    ).toBe("failed");
    expect(
      await f.owner.query(api.notifications.pushStatus, {
        endpoint: "https://fcm.googleapis.com/test",
      }),
    ).toEqual({ subscribed: false });
  } finally {
    vi.useRealTimers();
  }
});

test("push subscription updates and removal stay owner scoped and reject arbitrary network destinations", async () => {
  const f = await fixture(),
    endpoint = "https://fcm.googleapis.com/test";
  for (const bad of [
    "http://fcm.googleapis.com/test",
    "https://private.example/test",
    "https://fcm.googleapis.com.evil.example/test",
    "https://user:password@fcm.googleapis.com/test",
    "https://fcm.googleapis.com:8443/test",
  ])
    await expect(
      f.owner.mutation(api.notifications.subscribe, {
        endpoint: bad,
        p256dh: "synthetic",
        auth: "synthetic",
      }),
    ).rejects.toThrow("Unsupported push service");
  await f.owner.mutation(api.notifications.subscribe, {
    endpoint,
    p256dh: "one",
    auth: "one",
  });
  await f.owner.mutation(api.notifications.subscribe, {
    endpoint,
    p256dh: "two",
    auth: "two",
  });
  expect(
    await f.owner.query(api.notifications.pushStatus, { endpoint }),
  ).toEqual({ subscribed: true });
  expect(
    await f.stranger.query(api.notifications.pushStatus, { endpoint }),
  ).toEqual({ subscribed: false });
  await f.stranger.mutation(api.notifications.unsubscribe, { endpoint });
  expect(
    await f.owner.query(api.notifications.pushStatus, { endpoint }),
  ).toEqual({ subscribed: true });
  await f.owner.mutation(api.notifications.unsubscribe, { endpoint });
  expect(
    await f.owner.query(api.notifications.pushStatus, { endpoint }),
  ).toEqual({ subscribed: false });
});
for (const stop of [
  "decision",
  "account",
  "requester",
  "collector",
  "expiry",
] as const)
  test(`push job skips stale ${stop} before sending`, async () => {
    const f = await fixture();
    await f.owner.mutation(api.notifications.subscribe, {
      endpoint: "https://fcm.googleapis.com/test",
      p256dh: "synthetic",
      auth: "synthetic",
    });
    const r = await f.t.mutation(api.approvals.request, f.requestArgs);
    const jobs = await f.t.run((ctx) =>
      ctx.db
        .query("notificationJobs")
        .withIndex("by_requestId", (q) => q.eq("requestId", r.id))
        .take(10),
    );
    if (stop === "decision")
      await f.owner.mutation(api.approvals.decide, {
        id: r.id,
        approve: false,
      });
    if (stop === "account")
      await f.owner.mutation(api.accounts.block, { id: f.accountId });
    if (stop === "requester")
      await f.owner.mutation(api.clientConnections.update, {
        id: f.nativeConnection._id,
        stop: true,
      });
    if (stop === "collector")
      await f.owner.mutation(api.clientConnections.update, {
        id: f.helperConnection._id,
        stop: true,
      });
    if (stop === "expiry")
      await f.t.run((ctx) =>
        ctx.db.patch("approvalRequests", r.id, {
          approvalExpiresAt: Date.now() - 1,
        }),
      );
    expect(
      await f.t.mutation(internal.notifications.beginDelivery, {
        id: jobs[0]._id,
      }),
    ).toBeNull();
    expect(
      (await f.t.run((ctx) => ctx.db.get("notificationJobs", jobs[0]._id)))
        ?.status,
    ).toBe("cancelled");
  });
test("a crashed push action becomes eligible again and retries stop after five attempts", async () => {
  vi.useFakeTimers();
  try {
    const f = await fixture();
    await f.owner.mutation(api.notifications.subscribe, {
      endpoint: "https://fcm.googleapis.com/test",
      p256dh: "synthetic",
      auth: "synthetic",
    });
    const r = await f.t.mutation(api.approvals.request, f.requestArgs);
    const jobs = await f.t.run((ctx) =>
      ctx.db
        .query("notificationJobs")
        .withIndex("by_requestId", (q) => q.eq("requestId", r.id))
        .take(10),
    );
    const first = await f.t.mutation(internal.notifications.beginDelivery, {
      id: jobs[0]._id,
    });
    vi.setSystemTime(Date.now() + 31_000);
    const recovered = await f.t.mutation(internal.notifications.beginDelivery, {
      id: jobs[0]._id,
    });
    expect(recovered?.lease).not.toBe(first?.lease);
    await f.t.mutation(internal.notifications.finishDelivery, {
      id: jobs[0]._id,
      lease: recovered!.lease,
      outcome: "retry",
    });
    for (let attempt = 3; attempt <= 5; attempt++) {
      vi.setSystemTime(Date.now() + 120_001);
      const job = await f.t.mutation(internal.notifications.beginDelivery, {
        id: jobs[0]._id,
      });
      await f.t.mutation(internal.notifications.finishDelivery, {
        id: jobs[0]._id,
        lease: job!.lease,
        outcome: "retry",
      });
    }
    expect(
      (await f.t.run((ctx) => ctx.db.get("notificationJobs", jobs[0]._id)))
        ?.status,
    ).toBe("failed");
    expect(
      await f.t.mutation(internal.notifications.beginDelivery, {
        id: jobs[0]._id,
      }),
    ).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

for (const change of ["block", "reconnect"] as const)
  test(`completed callback retry cannot report success after ${change}`, async () => {
    const f = await fixture(),
      first = await attempt(f);
    const completionArgs = {
      ...completion(first.id),
      installationId: "installation-completed",
    };
    const completed = await f.owner.mutation(
      api.accounts.completeConnection,
      completionArgs,
    );
    const lookup = { secret, id: first.id, proofHash: "a".repeat(64) };
    expect(
      (await f.owner.query(api.accounts.connectionAttempt, lookup)).accountId,
    ).toBe(completed.accountId);
    if (change === "block")
      await f.owner.mutation(api.accounts.block, { id: completed.accountId });
    else {
      const replacement = await attempt(f, completed.accountId);
      await f.owner.mutation(
        api.accounts.completeConnection,
        completion(replacement.id),
      );
    }
    await expect(
      f.owner.query(api.accounts.connectionAttempt, lookup),
    ).rejects.toThrow("Account identity changed");
    await expect(
      f.owner.mutation(api.accounts.completeConnection, completionArgs),
    ).rejects.toThrow("Account identity changed");
  });
test("test notification sends only this owner's saved device and returns no subscription secrets", async () => {
  const f = await fixture(),
    endpoint = "https://fcm.googleapis.com/test";
  await f.owner.mutation(api.notifications.subscribe, {
    endpoint,
    p256dh: "private-push-key",
    auth: "private-push-auth",
  });
  await expect(
    f.t.action(api.notificationDelivery.test, { endpoint }),
  ).rejects.toThrow("Sign in required");
  expect(
    await f.stranger.action(api.notificationDelivery.test, { endpoint }),
  ).toEqual({ sent: 0, failed: 1, configured: true });
  expect(sendPush).not.toHaveBeenCalled();
  const result = await f.owner.action(api.notificationDelivery.test, {
    endpoint,
  });
  expect(result).toEqual({ sent: 1, failed: 0, configured: true });
  expect(sendPush).toHaveBeenCalledTimes(1);
  expect(sendPush.mock.calls[0][0]).toEqual({
    endpoint,
    keys: { p256dh: "private-push-key", auth: "private-push-auth" },
  });
  expect(JSON.stringify(result)).not.toContain("private-");
});
test("test notification returns configuration/failure facts and removes only a gone owner's subscription", async () => {
  const f = await fixture(),
    endpoint = "https://fcm.googleapis.com/test";
  await f.owner.mutation(api.notifications.subscribe, {
    endpoint,
    p256dh: "key",
    auth: "auth",
  });
  vi.stubEnv("SCOPE_VAPID_PRIVATE_KEY", "");
  expect(
    await f.owner.action(api.notificationDelivery.test, { endpoint }),
  ).toEqual({ sent: 0, failed: 0, configured: false });
  expect(sendPush).not.toHaveBeenCalled();
  vi.stubEnv("SCOPE_VAPID_PRIVATE_KEY", "synthetic-private");
  sendPush.mockRejectedValueOnce({ statusCode: 503, body: "private-push-key" });
  expect(
    await f.owner.action(api.notificationDelivery.test, { endpoint }),
  ).toEqual({ sent: 0, failed: 1, configured: true });
  expect(
    await f.owner.query(api.notifications.pushStatus, { endpoint }),
  ).toEqual({ subscribed: true });
  sendPush.mockRejectedValueOnce({ statusCode: 410, body: "private-push-key" });
  expect(
    await f.owner.action(api.notificationDelivery.test, { endpoint }),
  ).toEqual({ sent: 0, failed: 1, configured: true });
  expect(
    await f.owner.query(api.notifications.pushStatus, { endpoint }),
  ).toEqual({ subscribed: false });
  await expect(
    f.owner.action(api.notificationDelivery.test, {
      endpoint: "https://private.example/test",
    }),
  ).rejects.toThrow("Unsupported push service");
});

test("lost reconnect completion response retains superseded cleanup on callback retries until acknowledged", async () => {
  const f = await fixture(),
    reconnect = await attempt(f, f.accountId),
    complete = completion(reconnect.id, "usr-a");
  // Ignore the first completion response, as if the HTTP caller never received it.
  await f.owner.mutation(api.accounts.completeConnection, complete);
  const lookup = { secret, id: reconnect.id, proofHash: "a".repeat(64) };
  const retried = await f.owner.query(api.accounts.connectionAttempt, lookup);
  expect(retried.accountId).toBe(f.accountId);
  expect(retried.superseded?.connect.subjectId).toBe("grant-a");
  expect(
    (await f.owner.mutation(api.accounts.completeConnection, complete))
      .superseded,
  ).toEqual(retried.superseded);
  const acknowledge = {
    ...lookup,
    subjectId: "grant-a",
    outcome: "succeeded" as const,
  };
  await expect(
    f.stranger.mutation(api.accounts.acknowledgeSupersededCleanup, acknowledge),
  ).rejects.toThrow("Connection unavailable");
  await expect(
    f.owner.mutation(api.accounts.acknowledgeSupersededCleanup, {
      ...acknowledge,
      subjectId: reconnect.subjectId,
    }),
  ).rejects.toThrow("Superseded grant unavailable");
  await f.owner.mutation(
    api.accounts.acknowledgeSupersededCleanup,
    acknowledge,
  );
  await f.owner.mutation(
    api.accounts.acknowledgeSupersededCleanup,
    acknowledge,
  );
  expect(
    (await f.owner.query(api.accounts.connectionAttempt, lookup)).superseded,
  ).toBeUndefined();
  expect(
    (await f.owner.mutation(api.accounts.completeConnection, complete))
      .superseded,
  ).toBeUndefined();
});
test("failed superseded cleanup is never acknowledged and expires with the bounded attempt", async () => {
  const f = await fixture(),
    reconnect = await attempt(f, f.accountId);
  await f.owner.mutation(
    api.accounts.completeConnection,
    completion(reconnect.id, "usr-a"),
  );
  const lookup = { secret, id: reconnect.id, proofHash: "a".repeat(64) };
  await expect(
    f.owner.mutation(api.accounts.acknowledgeSupersededCleanup, {
      ...lookup,
      subjectId: "grant-a",
      outcome: "failed" as never,
    }),
  ).rejects.toThrow();
  expect(
    (await f.owner.query(api.accounts.connectionAttempt, lookup)).superseded
      ?.connect.subjectId,
  ).toBe("grant-a");
  await expect(
    f.owner.mutation(api.accounts.acknowledgeSupersededCleanup, {
      ...lookup,
      subjectId: "grant-a",
      outcome: "succeeded",
      proofHash: "b".repeat(64),
    }),
  ).rejects.toThrow("Connection unavailable");
  await f.t.run((ctx) =>
    ctx.db.patch("connectionAttempts", reconnect.id, {
      expiresAt: Date.now() - 1,
    }),
  );
  await expect(
    f.owner.mutation(api.accounts.acknowledgeSupersededCleanup, {
      ...lookup,
      subjectId: "grant-a",
      outcome: "succeeded",
    }),
  ).rejects.toThrow("Connection unavailable");
  await f.t.mutation(internal.accounts.expireAttempt, { id: reconnect.id });
  expect(
    await f.t.run((ctx) => ctx.db.get("connectionAttempts", reconnect.id)),
  ).toBeNull();
});
