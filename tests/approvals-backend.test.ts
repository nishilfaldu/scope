import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal, components } from "../convex/_generated/api";
import actionRetrierTest from "@convex-dev/action-retrier/test";
import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { retrier } from "../convex/notifications";
import type { Id } from "../convex/_generated/dataModel";
const modules = import.meta.glob("../convex/**/*.ts");
const secret = "service-test-secret",
  scopes = ["channels:read", "users:read"];
const { sendPush } = vi.hoisted(() => ({ sendPush: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: sendPush } }));
beforeEach(() => {
  vi.stubEnv("SCOPE_SERVICE_SECRET", secret);
  vi.stubEnv("SCOPE_CLI_CLIENT_ID", "cli-client");
  vi.stubEnv("WORKOS_CLIENT_ID", "web-client");
  vi.stubEnv("SCOPE_VAPID_PUBLIC_KEY", "synthetic-public");
  vi.stubEnv("SCOPE_VAPID_PRIVATE_KEY", "synthetic-private");
  sendPush.mockReset();
  sendPush.mockResolvedValue({ statusCode: 201 });
});
async function fixture(crashFirstPush = false) {
  const t = convexTest(schema, modules);
  let crash = crashFirstPush;
  t.registerComponent("actionRetrier", actionRetrierTest.schema, {
    ...actionRetrierTest.modules,
    "./component/run.ts": async () => {
      const original = await actionRetrierTest.modules["./component/run.ts"]();
      return {
        ...original,
        execute: internalActionGeneric({
          args: { runId: v.id("runs") },
          returns: v.null(),
          handler: async (ctx, args) => {
            if (crash) {
              crash = false;
              throw new Error("Simulated worker crash before completion");
            }
            await original.execute._handler(ctx, args);
            return null;
          },
        }),
      };
    },
  });
  const userId = "user_owner",
    strangerId = "user_stranger";
  const issuer = "https://api.workos.com/user_management/web-client";
  const owner = t.withIdentity({
      subject: userId,
      issuer,
      client_id: "web-client",
      sid: "session_browser",
    }),
    stranger = t.withIdentity({
      subject: strangerId,
      issuer,
      client_id: "web-client",
      sid: "session_stranger",
    });
  const actor = {
    secret,
    issuer,
    subject: userId,
    clientId: "cli-client",
    sessionId: "session_cli",
  };
  const connection = await t.mutation(api.clientConnections.ensure, actor);
  const connectionArgs = {
    secret,
    providerId: "slack",
    providerName: "Slack",
    accessDescription: "Read channels and people",
    connectorId: "slack-oauth",
    issuer: "https://convex.example",
    requestedScopes: scopes,
    proofHash: "a".repeat(64),
  };
  const completionArgs = {
    secret,
    proofHash: "a".repeat(64),
    providerUserId: "Uowner",
    providerTenantId: "Tworkspace",
    label: "Owner (Workspace)",
    installationId: "Igrant",
    grantedScopes: scopes,
  };
  const initial = await owner.mutation(
    api.accounts.beginConnection,
    connectionArgs,
  );
  const { accountId } = await owner.mutation(api.accounts.completeConnection, {
    ...completionArgs,
    id: initial.id,
  });
  const command = {
    argv: ["node", "read-slack.mjs"],
    cwd: "/tmp/scope-work",
    envVar: "SLACK_TOKEN",
  };
  const requestArgs = {
    ...actor,
    accountId,
    key: "one-task-key-123456789",
    reason: "Find the project channel",
    command,
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
    return { ...actor, id, grantVersion: 1, grantedScopes: scopes };
  }
  function preflight(id: Id<"approvalRequests">) {
    return t.query(api.approvals.preflight, { ...actor, id, now: Date.now() });
  }
  async function attempt(overrides = {}) {
    return owner.mutation(api.accounts.beginConnection, {
      ...connectionArgs,
      ...overrides,
    });
  }
  async function complete(id: Id<"connectionAttempts">, overrides = {}) {
    return owner.mutation(api.accounts.completeConnection, {
      ...completionArgs,
      id,
      ...overrides,
    });
  }
  async function revoke(id = accountId) {
    const blocked = await owner.mutation(api.accounts.block, { id });
    await owner.mutation(api.accounts.recordDisconnect, {
      secret,
      id,
      grantVersion: blocked.grantVersion,
      outcome: "succeeded",
    });
    return blocked;
  }
  return {
    t,
    owner,
    stranger,
    userId,
    strangerId,
    actor,
    connection,
    accountId,
    requestArgs,
    command,
    request,
    delivery,
    preflight,
    connectionArgs,
    completionArgs,
    attempt,
    complete,
    revoke,
    initial,
  };
}
test("browser ownership uses verified WorkOS subject across sessions, never email or an intended CLI token", async () => {
  const f = await fixture();
  const browser = {
    subject: f.userId,
    issuer: f.actor.issuer,
    client_id: "web-client",
    sid: "session_anotherbrowser",
  };
  const sameUser = f.t.withIdentity({
    ...browser,
    email: "changed@example.com",
  });
  expect(await sameUser.query(api.accounts.forOwner, {})).toMatchObject([
    { _id: f.accountId },
  ]);
  const sameEmail = f.t.withIdentity({
    ...browser,
    subject: f.strangerId,
    email: "owner@example.com",
  });
  expect(await sameEmail.query(api.accounts.forOwner, {})).toEqual([]);
  await expect(
    sameEmail.mutation(api.accounts.block, { id: f.accountId }),
  ).rejects.toThrow("Account unavailable");
  for (const changed of [
    { issuer: "https://api.workos.com/user_management/another-environment" },
    { client_id: "cli-client" },
    { client_id: "unrelated-app" },
    { sid: "app_consent_oldconnect" },
    { sid: "" },
    { subject: "scope:old-local-user" },
    { subject: "agent_untrusted" },
  ]) {
    const wrong = f.t.withIdentity({ ...browser, ...changed });
    await expect(wrong.query(api.accounts.forOwner, {})).rejects.toThrow(
      "Unauthorized",
    );
    await expect(
      wrong.action(api.notificationDelivery.test, {
        endpoint: "https://fcm.googleapis.com/test",
      }),
    ).rejects.toThrow("Unauthorized");
  }
  vi.stubEnv("WORKOS_CLIENT_ID", "");
  await expect(sameUser.query(api.accounts.forOwner, {})).rejects.toThrow(
    "Unauthorized",
  );
});
test("service authentication, configured first-party CLI client and full WorkOS session principal are required", async () => {
  const f = await fixture();
  for (const change of [
    { secret: "wrong" },
    { subject: "external-user" },
    { clientId: "another-client" },
    { sessionId: "" },
    { issuer: "https://untrusted.example" },
  ])
    await expect(
      f.t.mutation(api.clientConnections.ensure, { ...f.actor, ...change }),
    ).rejects.toThrow("Unauthorized");
  await expect(
    f.t.mutation(api.clientConnections.ensure, {
      ...f.actor,
      userId: f.strangerId,
    } as never),
  ).rejects.toThrow();
  expect(await f.t.mutation(api.clientConnections.ensure, f.actor)).toEqual(
    f.connection,
  );
  const consent = await f.t.mutation(api.clientConnections.ensure, {
    ...f.actor,
    sessionId: "session_other",
  });
  expect(consent._id).not.toBe(f.connection._id);
  await expect(
    f.t.mutation(api.clientConnections.ensure, {
      ...f.actor,
      issuer: "https://other.workos.example",
    }),
  ).rejects.toThrow("Unauthorized");
  const r = await f.request();
  vi.stubEnv("SCOPE_CLI_CLIENT_ID", "");
  await expect(f.preflight(r.id)).rejects.toThrow("Unauthorized");
});
test("one exact requesting connection is also the only credential recipient", async () => {
  const f = await fixture(),
    r = await f.request(),
    other = { ...f.actor, sessionId: "session_other" };
  await f.t.mutation(api.clientConnections.ensure, other);
  await expect(
    f.t.query(api.approvals.status, { ...other, id: r.id }),
  ).rejects.toThrow("Request unavailable");
  await expect(
    f.t.query(api.approvals.preflight, { ...other, id: r.id, now: Date.now() }),
  ).rejects.toThrow("Request unavailable");
  await expect(
    f.t.mutation(api.approvals.authorizeDelivery, {
      ...f.delivery(r.id),
      ...other,
    }),
  ).rejects.toThrow("Request unavailable");
  expect((await f.preflight(r.id)).status).toBe("acquire");
});
test("concurrent invocation retries preserve deadline; every command field, account and purpose are immutable", async () => {
  const f = await fixture(),
    r = await f.request();
  for (const retry of await Promise.all([
    f.t.mutation(api.approvals.request, f.requestArgs),
    f.t.mutation(api.approvals.request, f.requestArgs),
  ]))
    expect(retry).toMatchObject({
      id: r.id,
      approvalExpiresAt: r.approvalExpiresAt,
      created: false,
    });
  for (const command of [
    { ...f.command, argv: ["node", "other.mjs"] },
    { ...f.command, cwd: "/other" },
    { ...f.command, envVar: "OTHER_TOKEN" },
  ])
    await expect(
      f.t.mutation(api.approvals.request, { ...f.requestArgs, command }),
    ).rejects.toThrow("Idempotency conflict");
  await expect(
    f.t.mutation(api.approvals.request, {
      ...f.requestArgs,
      reason: "Different purpose",
    }),
  ).rejects.toThrow("Idempotency conflict");
  const attempt = await f.attempt(),
    b = await f.complete(attempt.id, { providerTenantId: "OtherWorkspace" });
  await expect(
    f.t.mutation(api.approvals.request, {
      ...f.requestArgs,
      accountId: b.accountId,
    }),
  ).rejects.toThrow("Idempotency conflict");
});
test("request rejects malformed command metadata and client-submitted per-request permissions", async () => {
  const f = await fixture();
  for (const command of [
    { ...f.command, argv: [] },
    { ...f.command, argv: [""] },
    { ...f.command, argv: Array(129).fill("arg") },
    { ...f.command, argv: ["x".repeat(4097)] },
    { ...f.command, argv: Array(5).fill("x".repeat(4096)) },
    { ...f.command, argv: Array(3).fill("é".repeat(4096)) },
    { ...f.command, argv: ["node\0oops"] },
    { ...f.command, cwd: "" },
    { ...f.command, cwd: "x".repeat(2049) },
    { ...f.command, cwd: "/tmp/\0work" },
    { ...f.command, envVar: "slack_token" },
    { ...f.command, envVar: "A".repeat(65) },
    { ...f.command, envVar: "INVALID=VALUE" },
  ])
    await expect(
      f.t.mutation(api.approvals.request, { ...f.requestArgs, command }),
    ).rejects.toThrow("Invalid request");
  await expect(
    f.t.mutation(api.approvals.request, {
      ...f.requestArgs,
      grantedScopes: ["channels:read"],
    } as never),
  ).rejects.toThrow();
});
test("full effective connection permissions are canonical, fixed and independent of command purpose", async () => {
  const f = await fixture();
  for (const requestedScopes of [
    [],
    [" channels:read "],
    [""],
    ["x".repeat(129)],
    Array(129).fill("channels:read"),
  ])
    await expect(f.attempt({ requestedScopes })).rejects.toThrow(
      "Invalid scopes",
    );
  const attempt = await f.attempt({
    requestedScopes: ["users:read", "channels:read", "users:read"],
  });
  expect(
    (
      await f.owner.query(api.accounts.connectionAttempt, {
        secret,
        id: attempt.id,
        proofHash: "a".repeat(64),
      })
    ).requestedScopes,
  ).toEqual(scopes);
  for (const grantedScopes of [
    ["channels:read"],
    ["channels:read", "users:read", "chat:write"],
  ])
    await expect(
      f.complete(attempt.id, {
        providerTenantId: "OtherWorkspace",
        grantedScopes,
      }),
    ).rejects.toThrow("Provider permissions differ");
  const b = await f.complete(attempt.id, {
    providerTenantId: "OtherWorkspace",
    grantedScopes: ["users:read", "channels:read", "channels:read"],
  });
  const r = await f.request(true, { accountId: b.accountId });
  expect(
    (await f.t.query(api.approvals.status, { ...f.actor, id: r.id })).snapshot
      .grantedScopes,
  ).toEqual(scopes);
  await expect(
    f.t.mutation(api.approvals.authorizeDelivery, {
      ...f.delivery(r.id),
      grantedScopes: ["channels:read"],
    }),
  ).rejects.toThrow("Delivery unavailable");
  await expect(
    f.t.mutation(api.approvals.authorizeDelivery, {
      ...f.delivery(r.id),
      grantedScopes: [...scopes, "chat:write"],
    }),
  ).rejects.toThrow("Delivery unavailable");
});
test("approval for one workspace never unlocks a distinct workspace authorization", async () => {
  const f = await fixture(),
    attempt = await f.attempt(),
    b = await f.complete(attempt.id, { providerTenantId: "OtherWorkspace" });
  const aRequest = await f.request(),
    bRequest = await f.t.mutation(api.approvals.request, {
      ...f.requestArgs,
      accountId: b.accountId,
      key: "workspace-B-key-123456",
    });
  const a = await f.preflight(aRequest.id);
  expect(a.status === "acquire" && a.account.providerTenantId).toBe(
    "Tworkspace",
  );
  expect(await f.preflight(bRequest.id)).toEqual({ status: "pending" });
  await f.revoke();
  await f.owner.mutation(api.approvals.decide, {
    id: bRequest.id,
    approve: true,
  });
  const next = await f.preflight(bRequest.id);
  expect(next.status === "acquire" && next.account.providerTenantId).toBe(
    "OtherWorkspace",
  );
});
test("denial, pending and expiry never authorize a credential release", async () => {
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
test("delivery retries keep stable private proof and deadline while provider expiry is observation only", async () => {
  const f = await fixture(),
    r = await f.request();
  const first = await f.t.mutation(api.approvals.authorizeDelivery, {
    ...f.delivery(r.id),
    tokenId: "first",
    providerExpiresAt: Date.now() + 120_000,
  });
  const second = await f.t.mutation(api.approvals.authorizeDelivery, {
    ...f.delivery(r.id),
    tokenId: "second",
    providerExpiresAt: Date.now() + 3600_000,
  });
  expect(second).toEqual(first);
  expect(first.approvalExpiresAt).toBe(r.approvalExpiresAt);
  const row = await f.t.run((ctx) => ctx.db.get("approvalRequests", r.id));
  expect(row?.deliveryAttempts).toBe(2);
  expect(row?.tokenId).toBe("second");
  expect(row?.providerExpiresAt).toBeGreaterThan(r.approvalExpiresAt);
  for (const field of [
    "accessToken",
    "refreshToken",
    "cipher",
    "fingerprint",
    "lease",
    "credentialId",
  ])
    expect(row).not.toHaveProperty(field);
  await expect(
    f.t.mutation(api.approvals.authorizeDelivery, {
      ...f.delivery(r.id),
      grantVersion: 2,
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
  "client-stop",
  "disconnect",
  "generation",
  "permissions",
  "expiry",
] as const)
  test(`${change} during provider IO prevents final release`, async () => {
    const f = await fixture(),
      r = await f.request();
    expect((await f.preflight(r.id)).status).toBe("acquire");
    if (change === "cancel")
      await f.owner.mutation(api.approvals.cancel, { id: r.id });
    if (change === "client-stop")
      await f.owner.mutation(api.clientConnections.update, {
        id: f.connection._id,
        stop: true,
      });
    if (change === "disconnect")
      await f.owner.mutation(api.accounts.block, { id: f.accountId });
    if (change === "generation")
      await f.t.run((ctx) =>
        ctx.db.patch("connectedAccounts", f.accountId, { grantVersion: 2 }),
      );
    if (change === "permissions")
      await f.t.run((ctx) =>
        ctx.db.patch("connectedAccounts", f.accountId, {
          grantedScopes: [...scopes, "chat:write"],
        }),
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
test("CLI cancellation is exact-principal bound and idempotent", async () => {
  const f = await fixture(),
    r = await f.t.mutation(api.approvals.request, f.requestArgs),
    other = { ...f.actor, sessionId: "session_different" };
  await f.t.mutation(api.clientConnections.ensure, other);
  await expect(
    f.t.mutation(api.approvals.cancelForClient, { ...other, id: r.id }),
  ).rejects.toThrow("Request unavailable");
  await f.t.mutation(api.approvals.cancelForClient, { ...f.actor, id: r.id });
  const first = await f.owner.query(api.approvals.requestForOwner, {
    reference: r.id,
  });
  await f.t.mutation(api.approvals.cancelForClient, { ...f.actor, id: r.id });
  expect(
    (await f.owner.query(api.approvals.requestForOwner, { reference: r.id }))
      ?.stoppedAt,
  ).toBe(first?.stoppedAt);
  expect((await f.preflight(r.id)).status).toBe("cancelled");
});
test("receipt is exact-recipient authenticated, historical and does not reopen cancelled or expired requests", async () => {
  const f = await fixture(),
    r = await f.request(),
    delivered = await f.t.mutation(
      api.approvals.authorizeDelivery,
      f.delivery(r.id),
    );
  const args = { ...f.actor, id: r.id, receiptProof: delivered.receiptProof },
    other = { ...f.actor, sessionId: "session_another" };
  await f.t.mutation(api.clientConnections.ensure, other);
  await expect(
    f.t.mutation(api.approvals.acknowledge, { ...args, ...other }),
  ).rejects.toThrow("Receipt unavailable");
  await expect(
    f.t.mutation(api.approvals.acknowledge, { ...args, receiptProof: "wrong" }),
  ).rejects.toThrow("Receipt unavailable");
  const before = await f.owner.query(api.approvals.requestForOwner, {
    reference: r.id,
  });
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
    ...f.actor,
    id: r.id,
  });
  expect(status).not.toHaveProperty("receiptProof");
  expect(status).not.toHaveProperty("tokenId");
});
test("owner decisions/history remain owner checked and secret free", async () => {
  const f = await fixture(),
    r = await f.request(),
    delivered = await f.t.mutation(
      api.approvals.authorizeDelivery,
      f.delivery(r.id),
    );
  await expect(
    f.stranger.mutation(api.approvals.cancel, { id: r.id }),
  ).rejects.toThrow("Request unavailable");
  await expect(
    f.stranger.mutation(api.approvals.decide, { id: r.id, approve: true }),
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
    expect(JSON.stringify(result)).not.toContain(delivered.receiptProof);
    expect(JSON.stringify(result)).not.toContain(f.initial.subjectId);
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
test("account/client renames keep original command, permission and display snapshots", async () => {
  const f = await fixture(),
    r = await f.request();
  await f.owner.mutation(api.clientConnections.update, {
    id: f.connection._id,
    name: "Renamed CLI",
  });
  await f.t.run((ctx) =>
    ctx.db.patch("connectedAccounts", f.accountId, {
      label: "Renamed account",
      providerName: "Changed provider label",
      accessDescription: "Changed description",
    }),
  );
  const detail = await f.owner.query(api.approvals.requestForOwner, {
    reference: r.id,
  });
  expect(detail?.snapshot).toMatchObject({
    accountLabel: "Owner (Workspace)",
    providerName: "Slack",
    accessDescription: "Read channels and people",
    requesterName: "CLI connection",
    grantedScopes: scopes,
  });
  expect(detail?.command).toEqual(f.command);
  await expect(
    f.stranger.mutation(api.clientConnections.update, {
      id: f.connection._id,
      name: "Impersonator",
    }),
  ).rejects.toThrow("Connection unavailable");
});
test("older pending requests remain discoverable behind completed history pagination", async () => {
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
test("pending requests tied to blocked account or stopped requester cannot be approved or released", async () => {
  for (const stop of ["account", "client"] as const) {
    const f = await fixture(),
      r = await f.t.mutation(api.approvals.request, f.requestArgs);
    if (stop === "account")
      await f.owner.mutation(api.accounts.block, { id: f.accountId });
    else
      await f.owner.mutation(api.clientConnections.update, {
        id: f.connection._id,
        stop: true,
      });
    await expect(
      f.owner.mutation(api.approvals.decide, { id: r.id, approve: true }),
    ).rejects.toThrow("Request unavailable");
    await expect(
      f.t.mutation(api.approvals.authorizeDelivery, f.delivery(r.id)),
    ).rejects.toThrow();
    const detail = await f.owner.query(api.approvals.requestForOwner, {
      reference: r.id,
    });
    expect(detail?.status).toBe("pending");
    if (stop === "account") expect(detail?.accountAvailable).toBe(false);
    else expect(detail?.requesterStopped).toBe(true);
  }
});
test("authorization completion requires owner/browser proof/provider identity and exact connector scopes", async () => {
  const f = await fixture(),
    attempt = await f.attempt(),
    args = { ...f.completionArgs, id: attempt.id, providerUserId: "OtherUser" };
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
  const result = await f.owner.mutation(api.accounts.completeConnection, args);
  expect(await f.owner.mutation(api.accounts.completeConnection, args)).toEqual(
    result,
  );
  expect(await f.owner.query(api.accounts.forOwner, {})).toHaveLength(2);
});
test("surviving duplicate user/workspace authorization is rejected, including failed revoke; different users/workspaces remain distinct", async () => {
  const f = await fixture(),
    duplicate = await f.attempt();
  await expect(f.complete(duplicate.id)).rejects.toThrow(
    "Revoke the previous authorization first",
  );
  await f.owner.mutation(api.accounts.block, { id: f.accountId });
  await expect(f.complete(duplicate.id)).rejects.toThrow(
    "Revoke the previous authorization first",
  );
  await f.owner.mutation(api.accounts.recordDisconnect, {
    secret,
    id: f.accountId,
    grantVersion: 1,
    outcome: "failed",
  });
  await expect(f.complete(duplicate.id)).rejects.toThrow(
    "Revoke the previous authorization first",
  );
  const user = await f.attempt(),
    workspace = await f.attempt();
  await f.complete(user.id, { providerUserId: "OtherUser" });
  await f.complete(workspace.id, { providerTenantId: "OtherWorkspace" });
  expect(await f.owner.query(api.accounts.forOwner, {})).toHaveLength(3);
});
test("permission changes require confirmed revoke and create a new grant generation; old requests remain fenced", async () => {
  const f = await fixture(),
    r = await f.request();
  await expect(f.attempt({ targetAccountId: f.accountId })).rejects.toThrow(
    "Revoke the previous authorization first",
  );
  await f.owner.mutation(api.accounts.block, { id: f.accountId });
  await expect(f.attempt({ targetAccountId: f.accountId })).rejects.toThrow(
    "Revoke the previous authorization first",
  );
  await f.owner.mutation(api.accounts.recordDisconnect, {
    secret,
    id: f.accountId,
    grantVersion: 1,
    outcome: "failed",
  });
  await expect(f.attempt({ targetAccountId: f.accountId })).rejects.toThrow(
    "Revoke the previous authorization first",
  );
  await f.revoke();
  const attempt = await f.attempt({
    targetAccountId: f.accountId,
    requestedScopes: ["channels:read"],
  });
  await expect(
    f.complete(attempt.id, {
      providerUserId: "DifferentUser",
      grantedScopes: ["channels:read"],
    }),
  ).rejects.toThrow("Account identity changed");
  expect(
    (await f.complete(attempt.id, { grantedScopes: ["channels:read"] }))
      .accountId,
  ).toBe(f.accountId);
  const account = await f.t.run((ctx) =>
    ctx.db.get("connectedAccounts", f.accountId),
  );
  expect(account?.grantVersion).toBe(2);
  expect(account?.grantedScopes).toEqual(["channels:read"]);
  expect((await f.preflight(r.id)).status).toBe("unavailable");
  await expect(
    f.t.mutation(api.approvals.authorizeDelivery, f.delivery(r.id)),
  ).rejects.toThrow("Delivery unavailable");
  expect(
    (await f.owner.query(api.approvals.requestForOwner, { reference: r.id }))
      ?.snapshot.grantedScopes,
  ).toEqual(scopes);
});
test("reconnect rechecks revoke outcome and competing generations before completing", async () => {
  const f = await fixture();
  await f.revoke();
  const a = await f.attempt({ targetAccountId: f.accountId }),
    b = await f.attempt({ targetAccountId: f.accountId });
  await f.t.run((ctx) =>
    ctx.db.patch("connectedAccounts", f.accountId, {
      disconnectOutcome: "failed",
    }),
  );
  await expect(f.complete(a.id)).rejects.toThrow("Account identity changed");
  await f.owner.mutation(api.accounts.recordDisconnect, {
    secret,
    id: f.accountId,
    grantVersion: 1,
    outcome: "succeeded",
  });
  await f.complete(a.id);
  await expect(f.complete(b.id)).rejects.toThrow("Account identity changed");
});
test("confirmed revoke cannot be downgraded by late failure or overwrite reconnected generation", async () => {
  const f = await fixture(),
    block = await f.revoke();
  await f.owner.mutation(api.accounts.recordDisconnect, {
    secret,
    id: f.accountId,
    grantVersion: 1,
    outcome: "failed",
  });
  expect(
    (await f.owner.query(api.accounts.forOwner, {}))[0].disconnectOutcome,
  ).toBe("succeeded");
  const next = await f.attempt({ targetAccountId: f.accountId });
  await f.complete(next.id);
  await expect(
    f.owner.mutation(api.accounts.recordDisconnect, {
      secret,
      id: f.accountId,
      grantVersion: block.grantVersion,
      outcome: "succeeded",
    }),
  ).rejects.toThrow("Account unavailable");
});
for (const change of ["block", "reconnect"] as const)
  test(`completed callback retry cannot report success after ${change}`, async () => {
    const f = await fixture(),
      lookup = { secret, id: f.initial.id, proofHash: "a".repeat(64) };
    expect(
      (await f.owner.query(api.accounts.connectionAttempt, lookup)).accountId,
    ).toBe(f.accountId);
    if (change === "block")
      await f.owner.mutation(api.accounts.block, { id: f.accountId });
    else {
      await f.revoke();
      const next = await f.attempt({ targetAccountId: f.accountId });
      await f.complete(next.id);
    }
    await expect(
      f.owner.query(api.accounts.connectionAttempt, lookup),
    ).rejects.toThrow("Account identity changed");
  });
test("expired connection attempts cannot complete and are cleaned without deleting account history", async () => {
  const f = await fixture(),
    attempt = await f.attempt();
  await f.t.run((ctx) =>
    ctx.db.patch("connectionAttempts", attempt.id, {
      expiresAt: Date.now() - 1,
    }),
  );
  await expect(f.complete(attempt.id)).rejects.toThrow(
    "Connection unavailable",
  );
  await f.t.mutation(internal.accounts.expireAttempt, { id: attempt.id });
  expect(
    await f.t.run((ctx) => ctx.db.get("connectionAttempts", attempt.id)),
  ).toBeNull();
  expect(await f.owner.query(api.accounts.forOwner, {})).toHaveLength(1);
});

test("the same shared provider authorization cannot be duplicated under another Scope owner", async () => {
  const f = await fixture();
  const attempt = await f.stranger.mutation(
    api.accounts.beginConnection,
    f.connectionArgs,
  );
  await expect(
    f.stranger.mutation(api.accounts.completeConnection, {
      ...f.completionArgs,
      id: attempt.id,
    }),
  ).rejects.toThrow("Revoke the previous authorization first");
  expect(await f.stranger.query(api.accounts.forOwner, {})).toEqual([]);
});
test("push subscription changes stay owner scoped and reject arbitrary destinations", async () => {
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
test("durable push retries enqueue once, retain the stable request tag and remove gone destinations", async () => {
  vi.useFakeTimers();
  const enqueue = vi.spyOn(retrier, "run");
  try {
    const f = await fixture(),
      endpoint = "https://fcm.googleapis.com/test";
    await f.owner.mutation(api.notifications.subscribe, {
      endpoint,
      p256dh: "private-push-key",
      auth: "private-push-auth",
    });
    sendPush.mockRejectedValueOnce({
      statusCode: 503,
      body: "private-push-auth",
    });
    sendPush.mockRejectedValueOnce({ statusCode: 410 });
    const r = await f.t.mutation(api.approvals.request, f.requestArgs);
    await f.t.mutation(api.approvals.request, f.requestArgs);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][2]).toEqual({
      requestId: r.id,
      subscriptionId: expect.any(String),
    });
    const runId = await enqueue.mock.results[0].value;
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(sendPush.mock.calls.map((call) => call[1])).toEqual(
      Array(2).fill(JSON.stringify({ requestId: r.id })),
    );
    expect(
      await f.t.query(components.actionRetrier.public.status, { runId }),
    ).toEqual({
      type: "completed",
      result: { type: "success", returnValue: null },
    });
    expect(
      await f.owner.query(api.notifications.pushStatus, { endpoint }),
    ).toEqual({ subscribed: false });
  } finally {
    enqueue.mockRestore();
    vi.useRealTimers();
  }
});
for (const stop of [
  "decision",
  "account",
  "requester",
  "permissions",
  "generation",
  "expiry",
  "unsubscribe",
] as const)
  test(`push retry skips stale ${stop}`, async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture(),
        endpoint = "https://fcm.googleapis.com/test";
      await f.owner.mutation(api.notifications.subscribe, {
        endpoint,
        p256dh: "synthetic",
        auth: "synthetic",
      });
      sendPush.mockRejectedValueOnce({ statusCode: 503 });
      const r = await f.t.mutation(api.approvals.request, f.requestArgs);
      // Finish the first attempt, then stop authority before the component retries.
      vi.advanceTimersByTime(0);
      await f.t.finishInProgressScheduledFunctions();
      expect(sendPush).toHaveBeenCalledTimes(1);
      if (stop === "decision")
        await f.owner.mutation(api.approvals.decide, {
          id: r.id,
          approve: false,
        });
      if (stop === "account")
        await f.owner.mutation(api.accounts.block, { id: f.accountId });
      if (stop === "requester")
        await f.owner.mutation(api.clientConnections.update, {
          id: f.connection._id,
          stop: true,
        });
      if (stop === "permissions")
        await f.t.run((ctx) =>
          ctx.db.patch("connectedAccounts", f.accountId, {
            grantedScopes: [...scopes, "chat:write"],
          }),
        );
      if (stop === "generation")
        await f.t.run((ctx) =>
          ctx.db.patch("connectedAccounts", f.accountId, { grantVersion: 2 }),
        );
      if (stop === "expiry")
        await f.t.run((ctx) =>
          ctx.db.patch("approvalRequests", r.id, {
            approvalExpiresAt: Date.now() - 1,
          }),
        );
      if (stop === "unsubscribe")
        await f.owner.mutation(api.notifications.unsubscribe, { endpoint });
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(sendPush).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
test("component heartbeat recovers a crashed push worker", async () => {
  vi.useFakeTimers();
  const enqueue = vi.spyOn(retrier, "run"),
    errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const f = await fixture(true);
    await f.owner.mutation(api.notifications.subscribe, {
      endpoint: "https://fcm.googleapis.com/test",
      p256dh: "synthetic",
      auth: "synthetic",
    });
    await f.t.mutation(api.approvals.request, f.requestArgs);
    const runId = await enqueue.mock.results[0].value;
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(
      await f.t.query(components.actionRetrier.public.status, { runId }),
    ).toEqual({
      type: "completed",
      result: { type: "success", returnValue: null },
    });
  } finally {
    enqueue.mockRestore();
    errorLog.mockRestore();
    vi.useRealTimers();
  }
});
test("push retries stop after five attempts and persist only sanitized errors", async () => {
  vi.useFakeTimers();
  const enqueue = vi.spyOn(retrier, "run"),
    errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const f = await fixture();
    await f.owner.mutation(api.notifications.subscribe, {
      endpoint: "https://fcm.googleapis.com/test",
      p256dh: "private-push-key",
      auth: "private-push-auth",
    });
    sendPush.mockRejectedValue({
      statusCode: 503,
      message: "private-push-key and private-push-auth",
    });
    await f.t.mutation(api.approvals.request, f.requestArgs);
    const runId = await enqueue.mock.results[0].value;
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sendPush).toHaveBeenCalledTimes(5);
    expect(
      await f.t.query(components.actionRetrier.public.status, { runId }),
    ).toEqual({
      type: "completed",
      result: { type: "failed", error: "Push delivery failed" },
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private-push");
  } finally {
    enqueue.mockRestore();
    errorLog.mockRestore();
    vi.useRealTimers();
  }
});
test("test push sends only saved owner device and returns no subscription secrets", async () => {
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
  expect(JSON.stringify(result)).not.toContain("private-");
});
test("test push returns configuration/failure facts and removes only gone owner's subscription", async () => {
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
});
