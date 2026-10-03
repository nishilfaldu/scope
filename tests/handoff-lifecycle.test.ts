/// <reference types="vite/client" />
import { managedFixture, managedGrant } from "./helpers/connect";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner@example.com" }),
  );
  const owner = t.withIdentity({ subject: `${userId}|session` });
  const inviteResponse = await t.fetch(
    "/api/agent-connections",
    post({ agentName: "Research agent" }),
  );
  expect(inviteResponse.status).toBe(201);
  const invite = await inviteResponse.json();
  await owner.mutation(api.tables.agentConnections.decideInvite, {
    publicToken: invite.connectUrl.split("/connect/")[1],
    decision: "approved",
  });
  const claimResponse = await t.fetch(
    "/api/agent-connections/claim",
    post({ claimHandle: invite.claimHandle }),
  );
  expect(claimResponse.status).toBe(200);
  const connection = await claimResponse.json();
  return { t, owner, userId, invite, connection };
}

test("pairing and slice handoff gate use until completion, then survive old deadlines", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const { t, owner, userId, invite, connection } = await setup();
  const discovery = await t.fetch("/");
  expect(discovery.status).toBe(200);
  const guide = await discovery.json();
  expect(guide.rediscoveryUrl).toMatch(/\/$/);
  expect(guide.integrationGuide.pairing.join(" ")).toContain(
    "/api/agent-connections/ack",
  );
  expect(guide.integrationGuide.slice.join(" ")).toContain(
    "/api/access-requests/ack",
  );

  const headers = {
    "x-agent-connection-id": connection.agentConnectionId,
    "x-agent-connection-secret": connection.agentConnectionSecret,
  };
  const requestBody = {
    apps: ["slack"],
    ttlMs: 60 * 60 * 1000,
    reason: "Read project issues",
  };
  const beforeAck = await t.fetch(
    "/api/access-requests",
    post(requestBody, headers),
  );
  expect(beforeAck.status).toBe(409);
  expect(await beforeAck.json()).toMatchObject({
    code: "CLAIM_ACK_REQUIRED",
    completionPath: "/api/agent-connections/ack",
    requiredBodyFields: ["claimHandle", "agentConnectionSecret"],
  });
  const prematureReconnect = await t.fetch(
    "/api/agent-connections",
    post({}, headers),
  );
  expect(prematureReconnect.status).toBe(409);
  expect(await prematureReconnect.json()).toMatchObject({
    code: "CLAIM_ACK_REQUIRED",
    completionPath: "/api/agent-connections/ack",
  });
  const badSecret = await t.fetch(
    "/api/access-requests",
    post(requestBody, {
      ...headers,
      "x-agent-connection-secret": "wrong",
    }),
  );
  expect(badSecret.status).toBe(401);
  expect(await badSecret.json()).not.toHaveProperty("completionPath");

  const ackBody = {
    claimHandle: invite.claimHandle,
    agentConnectionSecret: connection.agentConnectionSecret,
  };
  const firstAck = await t.fetch("/api/agent-connections/ack", post(ackBody));
  expect(firstAck.status).toBe(200);
  expect(await firstAck.json()).toMatchObject({
    resourceStatus: "active",
    handoffStatus: "ready",
  });
  vi.advanceTimersByTime(16 * 60 * 1000);
  await t.mutation(internal.tables.agentConnectionExpiry.expireInvite, {
    publicToken: invite.connectUrl.split("/connect/")[1],
  });
  const lateAck = await t.fetch("/api/agent-connections/ack", post(ackBody));
  expect(lateAck.status).toBe(200);
  expect(await lateAck.json()).toMatchObject({ resourceStatus: "active" });

  await t.mutation(
    internal.connect.connections.save,
    managedFixture({ userId, login: "slack-user", providerUserId: "1" }),
  );
  const account = (
    await owner.query(api.tables.connections.queries.statusesForApps, {
      apps: ["slack"],
    })
  )[0].accounts[0].id;
  const requestResponse = await t.fetch(
    "/api/access-requests",
    post(requestBody, headers),
  );
  expect(requestResponse.status).toBe(201);
  const request = await requestResponse.json();
  await owner.mutation(api.tables.slices.sliceRequests.decide, {
    publicToken: request.approvalUrl.split("/requests/new/")[1],
    decision: "approved",
    bindings: [{ app: "slack", connectionId: account }],
  });
  const sliceClaim = await t.fetch(
    "/api/access-requests/claim",
    post({ claimHandle: request.claimHandle }),
  );
  expect(sliceClaim.status).toBe(200);
  const slice = await sliceClaim.json();
  expect(slice).toMatchObject({
    ackRequired: true,
    handoffStatus: "awaiting_ack",
    nextAction: {
      path: "/api/access-requests/ack",
      requiredBodyFields: ["claimHandle", "sliceSecret"],
    },
  });
  const ownerStaged = await owner.query(api.tables.slices.sliceRequests.get, {
    publicToken: request.approvalUrl.split("/requests/new/")[1],
  });
  const privateStaged = await t.fetch(
    "/api/access-requests/status",
    post({
      claimHandle: request.claimHandle,
    }),
  );
  expect(ownerStaged?.handoffStatus).toBe("waiting_for_ack");
  expect((await privateStaged.json()).handoffStatus).toBe(
    ownerStaged?.handoffStatus,
  );
  const sliceHeaders = {
    "x-slice-token": slice.sliceToken,
    "x-slice-secret": slice.sliceSecret,
  };
  const beforeSliceAck = await t.fetch("/api/apps", { headers: sliceHeaders });
  expect(beforeSliceAck.status).toBe(409);
  expect(await beforeSliceAck.json()).toMatchObject({
    code: "CLAIM_ACK_REQUIRED",
  });
  for (const mintPolicy of ["approve", "auto"] as const) {
    await expect(
      owner.mutation(api.tables.slices.mutations.setMintPolicy, {
        sliceToken: slice.sliceToken,
        mintPolicy,
      }),
    ).rejects.toThrow("Slice is not live");
    const mint = await t.fetch(
      "/api/credentials",
      post({
        sliceToken: slice.sliceToken,
        sliceSecret: slice.sliceSecret,
        app: "slack",
      }),
    );
    expect(await mint.json()).toMatchObject({ code: "CLAIM_ACK_REQUIRED" });
  }
  const sliceAckBody = {
    claimHandle: request.claimHandle,
    sliceSecret: slice.sliceSecret,
  };
  const sliceAck = await t.fetch(
    "/api/access-requests/ack",
    post(sliceAckBody),
  );
  expect(sliceAck.status).toBe(200);
  expect(await sliceAck.json()).toMatchObject({ resourceStatus: "active" });
  await owner.mutation(api.tables.slices.mutations.setMintPolicy, {
    sliceToken: slice.sliceToken,
    mintPolicy: "approve",
  });
  await owner.mutation(api.tables.slices.mutations.setMintPolicy, {
    sliceToken: slice.sliceToken,
    mintPolicy: "auto",
  });
  vi.advanceTimersByTime(6 * 60 * 1000);
  await t.mutation(internal.tables.slices.sliceRequestExpiry.clearClaimSecret, {
    requestId: slice.requestId,
  });
  const afterOldDeadline = await t.fetch("/api/apps", {
    headers: sliceHeaders,
  });
  expect(afterOldDeadline.status).toBe(200);
  const lateSliceAck = await t.fetch(
    "/api/access-requests/ack",
    post(sliceAckBody),
  );
  expect(lateSliceAck.status).toBe(200);
  expect(await lateSliceAck.json()).toMatchObject({ resourceStatus: "active" });
  const sliceStatus = await t.fetch(
    "/api/access-requests/status",
    post({ claimHandle: request.claimHandle }),
  );
  expect(await sliceStatus.json()).toMatchObject({
    handoffStatus: "ready",
    resourceStatus: "active",
  });
  vi.advanceTimersByTime(60 * 60 * 1000);
  const expired = await t.fetch("/api/apps", { headers: sliceHeaders });
  expect(expired.status).toBe(403);
  expect(await expired.json()).toMatchObject({ code: "EXPIRED" });
  const clockExpired = await (
    await t.fetch(
      "/api/access-requests/status",
      post({ claimHandle: request.claimHandle }),
    )
  ).json();
  expect(clockExpired).toMatchObject({
    handoffStatus: "slice_expired",
    resourceStatus: "expired",
    serverTime: Date.now(),
    nextAction: { type: "stop_and_request_new_grant" },
  });
  const board = await owner.query(api.tables.agentDashboard.grantsPage, {
    agentConnectionId: connection.agentConnectionId,
    now: Date.now(),
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(board.page.find((row) => row._id === slice.sliceId)?.status).toBe(
    "expired",
  );
  await owner.mutation(api.tables.agentConnections.revoke, {
    agentConnectionId: connection.agentConnectionId,
  });
  const ownerRevoked = await owner.query(api.tables.slices.sliceRequests.get, {
    publicToken: request.approvalUrl.split("/requests/new/")[1],
  });
  const privateRevoked = await t.fetch(
    "/api/access-requests/status",
    post({
      claimHandle: request.claimHandle,
    }),
  );
  expect(ownerRevoked?.handoffStatus).toBe("slice_expired");
  expect((await privateRevoked.json()).handoffStatus).toBe(
    ownerRevoked?.handoffStatus,
  );
  expect(ownerRevoked?.resourceStatus).toBe("revoked");
});

test("completion is idempotent, preserves later revocation, and wrong endpoint names the correct one", async () => {
  const { t, owner, invite, connection } = await setup();
  const wrong = await t.fetch("/api/agent-connections/activate", {
    method: "POST",
    headers: {
      "x-agent-connection-id": connection.agentConnectionId,
      "x-agent-connection-secret": connection.agentConnectionSecret,
    },
  });
  expect(wrong.status).toBe(409);
  expect(await wrong.json()).toMatchObject({
    code: "CLAIM_ACK_REQUIRED",
    completionPath: "/api/agent-connections/ack",
  });
  const body = {
    claimHandle: invite.claimHandle,
    agentConnectionSecret: connection.agentConnectionSecret,
  };
  const invalidAck = await t.fetch(
    "/api/agent-connections/ack",
    post({
      ...body,
      agentConnectionSecret: "wrong",
    }),
  );
  expect(invalidAck.status).toBe(401);
  expect(await invalidAck.json()).toMatchObject({ code: "UNAUTHORIZED" });
  const ack = await t.fetch("/api/agent-connections/ack", post(body));
  expect(ack.status).toBe(200);
  const first = await ack.json();
  await owner.mutation(api.tables.agentConnections.revoke, {
    agentConnectionId: connection.agentConnectionId,
  });
  const retry = await t.fetch("/api/agent-connections/ack", post(body));
  expect(retry.status).toBe(200);
  expect(await retry.json()).toMatchObject({
    acknowledgedAt: first.acknowledgedAt,
    resourceStatus: "revoked",
    handoffStatus: "revoked",
  });
  const status = await t.fetch(
    "/api/agent-connections/status",
    post({ claimHandle: invite.claimHandle }),
  );
  expect(await status.json()).toMatchObject({
    handoffStatus: "revoked",
    resourceStatus: "revoked",
  });
  const reclaim = await t.fetch(
    "/api/agent-connections/claim",
    post({ claimHandle: invite.claimHandle }),
  );
  expect(reclaim.status).toBe(409);
  expect(await reclaim.json()).toMatchObject({
    code: "CLAIM_ALREADY_ACKNOWLEDGED",
  });
});

test("first claim fixes the completion deadline and an old pickup job cannot retire it", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner@example.com" }),
  );
  const owner = t.withIdentity({ subject: `${userId}|session` });
  const inviteResponse = await t.fetch(
    "/api/agent-connections",
    post({ agentName: "Agent" }),
  );
  const invite = await inviteResponse.json();
  const publicToken = invite.connectUrl.split("/connect/")[1];
  await owner.mutation(api.tables.agentConnections.decideInvite, {
    publicToken,
    decision: "approved",
  });
  const approval = await t.fetch(
    "/api/agent-connections/status",
    post({ claimHandle: invite.claimHandle }),
  );
  const pickupDeadline = (await approval.json()).pickupDeadlineAt;
  vi.setSystemTime(pickupDeadline - 1);
  const firstResponse = await t.fetch(
    "/api/agent-connections/claim",
    post({ claimHandle: invite.claimHandle }),
  );
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json();
  expect(first.ackDeadlineAt).toBe(pickupDeadline - 1 + 2 * 60 * 1000);
  vi.setSystemTime(pickupDeadline + 1);
  await t.mutation(internal.tables.agentConnectionExpiry.expireInvite, {
    publicToken,
  });
  const retry = await t.fetch(
    "/api/agent-connections/claim",
    post({ claimHandle: invite.claimHandle }),
  );
  expect(retry.status).toBe(200);
  expect(await retry.json()).toMatchObject({
    agentConnectionSecret: first.agentConnectionSecret,
    ackDeadlineAt: first.ackDeadlineAt,
  });
  vi.setSystemTime(first.ackDeadlineAt);
  const lateAck = await t.fetch(
    "/api/agent-connections/ack",
    post({
      claimHandle: invite.claimHandle,
      agentConnectionSecret: first.agentConnectionSecret,
    }),
  );
  expect(lateAck.status).toBe(403);
  expect(await lateAck.json()).toMatchObject({ code: "EXPIRED" });
  await t.mutation(internal.tables.agentConnectionExpiry.expireInvite, {
    publicToken,
  });
  const status = await t.fetch(
    "/api/agent-connections/status",
    post({ claimHandle: invite.claimHandle }),
  );
  expect(await status.json()).toMatchObject({
    handoffStatus: "claim_ack_timeout",
    reason: "claim_ack_timeout",
    resourceStatus: "revoked",
  });
});

test("canceled requests leave the pending quota and report a terminal status", async () => {
  const { t, invite, connection } = await setup();
  const headers = {
    "x-agent-connection-id": connection.agentConnectionId,
    "x-agent-connection-secret": connection.agentConnectionSecret,
  };
  await t.fetch(
    "/api/agent-connections/ack",
    post({
      claimHandle: invite.claimHandle,
      agentConnectionSecret: connection.agentConnectionSecret,
    }),
  );
  for (let i = 0; i < 101; i++) {
    const response = await t.fetch(
      "/api/access-requests",
      post(
        {
          apps: ["slack"],
          ttlMs: 60_000,
          reason: `Task ${i}`,
        },
        headers,
      ),
    );
    expect(response.status).toBe(201);
    const request = await response.json();
    const canceled = await t.fetch(
      "/api/access-requests/cancel",
      post(
        {
          claimHandle: request.claimHandle,
        },
        headers,
      ),
    );
    expect(canceled.status).toBe(200);
    const status = await t.fetch(
      "/api/access-requests/status",
      post({
        claimHandle: request.claimHandle,
      }),
    );
    expect(await status.json()).toMatchObject({
      status: "denied",
      handoffStatus: "agent_cancelled",
    });
    if (i === 0) {
      const claim = await t.fetch(
        "/api/access-requests/claim",
        post({ claimHandle: request.claimHandle }),
      );
      expect(claim.status).toBe(403);
      expect(await claim.json()).toMatchObject({ code: "APPROVAL_EXPIRED" });
    }
  }
});

test("an integrator follows discovery through issuance, replacement, timeout, and recovery", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      email: "integrator@example.com",
    }),
  );
  const owner = t.withIdentity({ subject: `${userId}|session` });
  await t.mutation(
    internal.connect.connections.save,
    managedFixture({ userId, login: "integrator", providerUserId: "1" }),
  );
  const guide = await (await t.fetch("/")).json();
  const route = (instruction: string) => {
    const path = instruction.match(/(?:GET|POST) (\/api\/[a-z/-]+)/)?.[1];
    expect(path).toBeTruthy();
    expect(
      guide.routes.some((item: { path: string }) => item.path === path),
    ).toBe(true);
    return path!;
  };
  const pairing = guide.integrationGuide.pairing as string[];
  const sliceSteps = guide.integrationGuide.slice as string[];
  const created = await t.fetch(
    route(pairing[0]),
    post({ agentName: "Discovery integrator" }),
  );
  expect(created.status).toBe(201);
  const invite = await created.json();
  const publicToken = invite.connectUrl.split("/connect/")[1];
  const statusPath = invite.nextAction.path;
  expect(statusPath).toBe(route(pairing[1]));
  expect(
    (
      await (
        await t.fetch(statusPath, post({ claimHandle: invite.claimHandle }))
      ).json()
    ).handoffStatus,
  ).toBe("waiting_for_approval");
  await owner.mutation(api.tables.agentConnections.decideInvite, {
    publicToken,
    decision: "approved",
  });
  const pairingStatus = await (
    await t.fetch(statusPath, post({ claimHandle: invite.claimHandle }))
  ).json();
  expect(pairingStatus.handoffStatus).toBe("waiting_for_pickup");
  const claimed = await t.fetch(
    pairingStatus.nextAction.path,
    post({ claimHandle: invite.claimHandle }),
  );
  expect(claimed.status).toBe(200);
  const connection = await claimed.json();
  const ack = await t.fetch(
    connection.nextAction.path,
    post({
      claimHandle: invite.claimHandle,
      agentConnectionSecret: connection.agentConnectionSecret,
    }),
  );
  expect((await ack.json()).resourceStatus).toBe("active");
  const headers = {
    "x-agent-connection-id": connection.agentConnectionId,
    "x-agent-connection-secret": connection.agentConnectionSecret,
  };
  const requestResponse = await t.fetch(
    route(sliceSteps[0]),
    post(
      {
        apps: ["slack"],
        ttlMs: 60 * 60_000,
        reason: "Check issues",
      },
      headers,
    ),
  );
  expect(requestResponse.status).toBe(201);
  const request = await requestResponse.json();
  const account = (
    await owner.query(api.tables.connections.queries.statusesForApps, {
      apps: ["slack"],
    })
  )[0].accounts[0].id;
  await owner.mutation(api.tables.slices.sliceRequests.decide, {
    publicToken: request.approvalUrl.split("/requests/new/")[1],
    decision: "approved",
    bindings: [{ app: "slack", connectionId: account }],
  });
  const requestStatus = await (
    await t.fetch(
      request.nextAction.path,
      post({ claimHandle: request.claimHandle }),
    )
  ).json();
  expect(requestStatus.handoffStatus).toBe("waiting_for_pickup");
  const slice = await (
    await t.fetch(
      requestStatus.nextAction.path,
      post({ claimHandle: request.claimHandle }),
    )
  ).json();
  const sliceAck = await t.fetch(
    slice.nextAction.path,
    post({
      claimHandle: request.claimHandle,
      sliceSecret: slice.sliceSecret,
    }),
  );
  expect((await sliceAck.json()).resourceStatus).toBe("active");
  const accountsPath = sliceSteps[3].match(/GET (\/api\/[a-z/-]+)/)?.[1];
  expect(accountsPath).toBeTruthy();
  const accounts = await t.fetch(`${accountsPath}?app=slack`, {
    headers: {
      "x-slice-token": slice.sliceToken,
      "x-slice-secret": slice.sliceSecret,
    },
  });
  expect(accounts.status).toBe(200);
  let issued = 0;
  const mint = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify(managedGrant(`xoxe.xoxp-discovered_${++issued}`)),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
  try {
    const mintPath = sliceSteps[3].match(/POST (\/api\/[a-z/-]+)/)?.[1];
    expect(mintPath).toBeTruthy();
    const mint = await t.fetch(
      mintPath!,
      post({
        sliceToken: slice.sliceToken,
        sliceSecret: slice.sliceSecret,
        app: "slack",
      }),
    );
    expect(mint.status).toBe(200);
    expect(await mint.json()).toMatchObject({
      accessToken: "xoxe.xoxp-discovered_1",
      ackRequired: false,
      credentialExpiresAt: expect.any(Number),
    });
    const rotationPath = route(guide.integrationGuide.replacement);
    const rotate = async (currentHeaders: Record<string, string>) => {
      const pendingResponse = await t.fetch(
        rotationPath,
        post({}, currentHeaders),
      );
      expect(pendingResponse.status).toBe(201);
      const pending = await pendingResponse.json();
      await owner.mutation(api.tables.agentConnections.decideInvite, {
        publicToken: pending.connectUrl.split("/connect/")[1],
        decision: "approved",
      });
      const readyForPickup = await (
        await t.fetch(
          pending.nextAction.path,
          post({ claimHandle: pending.claimHandle }),
        )
      ).json();
      const replacement = await (
        await t.fetch(
          readyForPickup.nextAction.path,
          post({ claimHandle: pending.claimHandle }),
        )
      ).json();
      expect(replacement).toMatchObject({
        activationRequired: true,
        ackRequired: false,
      });
      const replacementHeaders = {
        "x-agent-connection-id": replacement.agentConnectionId,
        "x-agent-connection-secret": replacement.agentConnectionSecret,
      };
      return { pending, replacement, replacementHeaders };
    };
    const rotated = await rotate(headers);
    const unfinished = await t.fetch(
      route(sliceSteps[0]),
      post(
        {
          apps: ["slack"],
          ttlMs: 60_000,
          reason: "Rotation check",
        },
        rotated.replacementHeaders,
      ),
    );
    expect(unfinished.status).toBe(409);
    const completion = await unfinished.json();
    expect(completion.code).toBe("ACTIVATION_REQUIRED");
    expect(completion.completionPath).toBe(rotated.replacement.nextAction.path);
    const activation = await (
      await t.fetch(
        completion.completionPath,
        post({}, rotated.replacementHeaders),
      )
    ).json();
    expect(activation).toMatchObject({
      status: "active",
      handoffStatus: "ready",
    });
    vi.advanceTimersByTime(16 * 60_000);
    await t.mutation(internal.tables.agentConnectionExpiry.expireInvite, {
      publicToken: rotated.pending.connectUrl.split("/connect/")[1],
    });

    expect(
      await (
        await t.fetch(
          completion.completionPath,
          post({}, rotated.replacementHeaders),
        )
      ).json(),
    ).toMatchObject({ activatedAt: activation.activatedAt, status: "active" });
    const preserved = await t.fetch(`${accountsPath}?app=slack`, {
      headers: {
        "x-slice-token": slice.sliceToken,
        "x-slice-secret": slice.sliceSecret,
      },
    });
    expect(preserved.status).toBe(200);
    const oldCredential = await t.fetch(
      route(sliceSteps[0]),
      post(
        {
          apps: ["slack"],
          ttlMs: 60_000,
          reason: "Retired credentials",
        },
        headers,
      ),
    );
    expect(await oldCredential.json()).toMatchObject({ code: "REVOKED" });

    const timedOut = await rotate(rotated.replacementHeaders);
    vi.setSystemTime(timedOut.replacement.activationDeadlineAt);
    const expired = await (
      await t.fetch(
        timedOut.pending.nextAction.path,
        post({ claimHandle: timedOut.pending.claimHandle }),
      )
    ).json();
    expect(expired).toMatchObject({
      handoffStatus: "activation_timeout",
      nextAction: { type: "stop_and_request_new_pairing" },
    });
    expect(
      await (
        await t.fetch(
          timedOut.replacement.nextAction.path,
          post({}, timedOut.replacementHeaders),
        )
      ).json(),
    ).toMatchObject({ code: "EXPIRED" });

    const rediscovered = await (
      await t.fetch(new URL(guide.rediscoveryUrl).pathname)
    ).json();
    expect(rediscovered.integrationGuide.replacement).toBe(
      guide.integrationGuide.replacement,
    );
    const recovered = await rotate(rotated.replacementHeaders);
    expect(
      (
        await t.fetch(
          recovered.replacement.nextAction.path,
          post({}, recovered.replacementHeaders),
        )
      ).status,
    ).toBe(200);
    const ownerRecovered = await owner.query(
      api.tables.agentConnections.getInvite,
      {
        publicToken: recovered.pending.connectUrl.split("/connect/")[1],
        now: Date.now(),
      },
    );
    const privateRecovered = await (
      await t.fetch(
        recovered.pending.nextAction.path,
        post({ claimHandle: recovered.pending.claimHandle }),
      )
    ).json();
    expect(ownerRecovered).toMatchObject({
      handoffStatus: "ready",
      resourceStatus: "active",
    });
    expect(privateRecovered.handoffStatus).toBe(ownerRecovered?.handoffStatus);

    await owner.mutation(api.tables.slices.mutations.setMintPolicy, {
      sliceToken: slice.sliceToken,
      mintPolicy: "approve",
    });
    const approvalRequired = await t.fetch(
      mintPath!,
      post({
        sliceToken: slice.sliceToken,
        sliceSecret: slice.sliceSecret,
        app: "slack",
      }),
    );
    expect(approvalRequired.status).toBe(202);
    const mintRequest = await approvalRequired.json();
    await owner.mutation(api.tables.slices.tokenRequests.decide, {
      publicToken: mintRequest.approvalUrl.split("/requests/token/")[1],
      decision: "approved",
    });
    const mintClaimPath = sliceSteps[3].match(
      /after approval POST (\/api\/[a-z/-]+)/,
    )?.[1];
    expect(mintClaimPath).toBeTruthy();
    const approvedMint = await t.fetch(
      mintClaimPath!,
      post({
        sliceToken: slice.sliceToken,
        sliceSecret: slice.sliceSecret,
        requestId: mintRequest.requestId,
      }),
    );
    expect(approvedMint.status).toBe(200);
    expect(await approvedMint.json()).toMatchObject({
      accessToken: "xoxe.xoxp-discovered_2",
      ackRequired: false,
    });
  } finally {
    mint.mockRestore();
    vi.unstubAllEnvs();
  }
});

test("a revoked predecessor ends a staged replacement instead of recommending activation", async () => {
  const { t, owner, invite, connection } = await setup();
  await t.fetch(
    "/api/agent-connections/ack",
    post({
      claimHandle: invite.claimHandle,
      agentConnectionSecret: connection.agentConnectionSecret,
    }),
  );
  const oldHeaders = {
    "x-agent-connection-id": connection.agentConnectionId,
    "x-agent-connection-secret": connection.agentConnectionSecret,
  };
  const replacementResponse = await t.fetch(
    "/api/agent-connections",
    post({}, oldHeaders),
  );
  expect(replacementResponse.status).toBe(201);
  const replacement = await replacementResponse.json();
  await owner.mutation(api.tables.agentConnections.decideInvite, {
    publicToken: replacement.connectUrl.split("/connect/")[1],
    decision: "approved",
  });
  const claimed = await (
    await t.fetch(
      "/api/agent-connections/claim",
      post({ claimHandle: replacement.claimHandle }),
    )
  ).json();
  const before = await (
    await t.fetch(
      "/api/agent-connections/status",
      post({ claimHandle: replacement.claimHandle }),
    )
  ).json();
  expect(before.handoffStatus).toBe("waiting_for_activation");
  await t.fetch("/api/agent-connections/revoke", post({}, oldHeaders));
  const after = await (
    await t.fetch(
      "/api/agent-connections/status",
      post({ claimHandle: replacement.claimHandle }),
    )
  ).json();
  expect(after).toMatchObject({
    handoffStatus: "revoked",
    resourceStatus: "revoked",
  });
  const reconnect = await t.fetch(
    "/api/agent-connections",
    post(
      {},
      {
        "x-agent-connection-id": claimed.agentConnectionId,
        "x-agent-connection-secret": claimed.agentConnectionSecret,
      },
    ),
  );
  expect(reconnect.status).toBe(403);
  expect(await reconnect.json()).toMatchObject({ code: "REVOKED" });
  const activate = await t.fetch(
    "/api/agent-connections/activate",
    post(
      {},
      {
        "x-agent-connection-id": claimed.agentConnectionId,
        "x-agent-connection-secret": claimed.agentConnectionSecret,
      },
    ),
  );
  expect(activate.status).toBe(403);
  expect(await activate.json()).toMatchObject({ code: "REVOKED" });
});

test("slice cleanup preserves the earliest terminal event", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const { t, owner, userId, invite, connection } = await setup();
  await t.fetch(
    "/api/agent-connections/ack",
    post({
      claimHandle: invite.claimHandle,
      agentConnectionSecret: connection.agentConnectionSecret,
    }),
  );
  await t.mutation(
    internal.connect.connections.save,
    managedFixture({ userId, login: "owner", providerUserId: "1" }),
  );
  const account = (
    await owner.query(api.tables.connections.queries.statusesForApps, {
      apps: ["slack"],
    })
  )[0].accounts[0].id;
  const headers = {
    "x-agent-connection-id": connection.agentConnectionId,
    "x-agent-connection-secret": connection.agentConnectionSecret,
  };
  const makeSlice = async (ttlMs: number) => {
    const request = await (
      await t.fetch(
        "/api/access-requests",
        post(
          {
            apps: ["slack"],
            ttlMs,
            reason: "Check issue",
          },
          headers,
        ),
      )
    ).json();
    await owner.mutation(api.tables.slices.sliceRequests.decide, {
      publicToken: request.approvalUrl.split("/requests/new/")[1],
      decision: "approved",
      bindings: [{ app: "slack", connectionId: account }],
    });
    const slice = await (
      await t.fetch(
        "/api/access-requests/claim",
        post({
          claimHandle: request.claimHandle,
        }),
      )
    ).json();
    return { request, slice };
  };
  const earlierRevocation = await makeSlice(60 * 60_000);
  const earlierTimeout = await makeSlice(3 * 60_000);
  vi.advanceTimersByTime(60_000);
  await owner.mutation(api.tables.slices.mutations.revoke, {
    sliceToken: earlierRevocation.slice.sliceToken,
  });
  vi.advanceTimersByTime(61_000);
  await t.mutation(internal.tables.slices.sliceRequestExpiry.clearClaimSecret, {
    requestId: earlierRevocation.slice.requestId,
  });
  const revokedStatus = await (
    await t.fetch(
      "/api/access-requests/status",
      post({ claimHandle: earlierRevocation.request.claimHandle }),
    )
  ).json();
  expect(revokedStatus.reasonCode).toBe("operator_revoked");
  vi.advanceTimersByTime(60_000);
  await t.mutation(internal.tables.slices.sliceRequestExpiry.clearClaimSecret, {
    requestId: earlierTimeout.slice.requestId,
  });
  const timeoutStatus = await (
    await t.fetch(
      "/api/access-requests/status",
      post({ claimHandle: earlierTimeout.request.claimHandle }),
    )
  ).json();
  expect(timeoutStatus.reasonCode).toBe("claim_ack_timeout");
  const parentRevoked = await makeSlice(60 * 60_000);
  vi.advanceTimersByTime(60_000);
  await owner.mutation(api.tables.agentConnections.revoke, {
    agentConnectionId: connection.agentConnectionId,
  });
  const beforeCleanup = await (
    await t.fetch(
      "/api/access-requests/status",
      post({ claimHandle: parentRevoked.request.claimHandle }),
    )
  ).json();
  expect(beforeCleanup.reasonCode).toBe("agent_connection_revoked");
  vi.advanceTimersByTime(61_000);
  await t.mutation(internal.tables.slices.sliceRequestExpiry.clearClaimSecret, {
    requestId: parentRevoked.slice.requestId,
  });
  const afterCleanup = await (
    await t.fetch(
      "/api/access-requests/status",
      post({ claimHandle: parentRevoked.request.claimHandle }),
    )
  ).json();
  expect(afterCleanup.reasonCode).toBe("agent_connection_revoked");
});

test.each(["before", "after", "equal"] as const)(
  "connection revocation %s its deadline preserves the first cause through cleanup and auth",
  async (order) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { t, owner, invite, connection } = await setup();
    const publicToken = invite.connectUrl.split("/connect/")[1];
    vi.setSystemTime(
      connection.ackDeadlineAt +
        (order === "before" ? -1 : order === "after" ? 1 : 0),
    );
    await owner.mutation(api.tables.agentConnections.revoke, {
      agentConnectionId: connection.agentConnectionId,
    });
    const reason =
      order === "before" ? "operator_revoked" : "claim_ack_timeout";
    const headers = {
      "x-agent-connection-id": connection.agentConnectionId,
      "x-agent-connection-secret": connection.agentConnectionSecret,
    };
    for (const cleanup of [false, true]) {
      if (cleanup) {
        vi.setSystemTime(connection.ackDeadlineAt + 10_000);
        await t.mutation(internal.tables.agentConnectionExpiry.expireInvite, {
          publicToken,
        });
      }
      const privateStatus = await (
        await t.fetch(
          "/api/agent-connections/status",
          post({ claimHandle: invite.claimHandle }),
        )
      ).json();
      const ownerStatus = await owner.query(
        api.tables.agentConnections.getInvite,
        { publicToken, now: Date.now() },
      );
      expect(privateStatus).toMatchObject({
        reason,
        resourceStatus: "revoked",
      });
      expect(ownerStatus).toMatchObject({
        handoffStatus: privateStatus.handoffStatus,
        reason,
      });
      for (const path of ["/api/agent-connections", "/api/access-requests"]) {
        const response = await t.fetch(
          path,
          post({ apps: ["slack"], ttlMs: 60_000, reason: "Check" }, headers),
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          code: order === "before" ? "REVOKED" : "EXPIRED",
        });
      }
    }
  },
);

test("a competing activation retires other replacements in every status and credential path", async () => {
  const { t, owner, invite, connection } = await setup();
  await t.fetch(
    "/api/agent-connections/ack",
    post({
      claimHandle: invite.claimHandle,
      agentConnectionSecret: connection.agentConnectionSecret,
    }),
  );
  const oldHeaders = {
    "x-agent-connection-id": connection.agentConnectionId,
    "x-agent-connection-secret": connection.agentConnectionSecret,
  };
  const stage = async () => {
    const invitation = await (
      await t.fetch("/api/agent-connections", post({}, oldHeaders))
    ).json();
    const publicToken = invitation.connectUrl.split("/connect/")[1];
    await owner.mutation(api.tables.agentConnections.decideInvite, {
      publicToken,
      decision: "approved",
    });
    const claimed = await (
      await t.fetch(
        "/api/agent-connections/claim",
        post({ claimHandle: invitation.claimHandle }),
      )
    ).json();
    return { ...claimed, publicToken, claimHandle: invitation.claimHandle };
  };
  const abandoned = await stage();
  const winner = await stage();
  expect(
    (
      await t.fetch(
        "/api/agent-connections/activate",
        post(
          {},
          {
            "x-agent-connection-id": winner.agentConnectionId,
            "x-agent-connection-secret": winner.agentConnectionSecret,
          },
        ),
      )
    ).status,
  ).toBe(200);
  const headers = {
    "x-agent-connection-id": abandoned.agentConnectionId,
    "x-agent-connection-secret": abandoned.agentConnectionSecret,
  };
  for (const path of [
    "/api/agent-connections",
    "/api/access-requests",
    "/api/agent-connections/activate",
    "/api/agent-connections/ack",
    "/api/agent-connections/claim",
  ]) {
    const response = await t.fetch(
      path,
      post(
        {
          claimHandle: abandoned.claimHandle,
          agentConnectionSecret: abandoned.agentConnectionSecret,
          apps: ["slack"],
          ttlMs: 60_000,
          reason: "Check",
        },
        headers,
      ),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "REVOKED" });
  }
  const status = await (
    await t.fetch(
      "/api/agent-connections/status",
      post({ claimHandle: abandoned.claimHandle }),
    )
  ).json();
  expect(status).toMatchObject({
    reason: "predecessor_revoked",
    nextAction: { type: "stop_and_request_new_pairing" },
  });
  expect(
    await owner.query(api.tables.agentConnections.getInvite, {
      publicToken: abandoned.publicToken,
    }),
  ).toMatchObject({
    handoffStatus: status.handoffStatus,
    reason: status.reason,
  });

  await t.fetch("/api/agent-connections/revoke", post({}, headers));
  expect(
    (
      await t.fetch(
        "/api/access-requests",
        post(
          { apps: ["slack"], ttlMs: 60_000, reason: "Check" },
          {
            "x-agent-connection-id": winner.agentConnectionId,
            "x-agent-connection-secret": winner.agentConnectionSecret,
          },
        ),
      )
    ).status,
  ).toBe(201);
});

test("late cancellation cannot replace an approval timeout", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const { t, invite, connection } = await setup();
  await t.fetch(
    "/api/agent-connections/ack",
    post({
      claimHandle: invite.claimHandle,
      agentConnectionSecret: connection.agentConnectionSecret,
    }),
  );
  const headers = {
    "x-agent-connection-id": connection.agentConnectionId,
    "x-agent-connection-secret": connection.agentConnectionSecret,
  };
  const pairing = await (
    await t.fetch("/api/agent-connections", post({ agentName: "Late" }))
  ).json();
  const request = await (
    await t.fetch(
      "/api/access-requests",
      post({ apps: ["slack"], ttlMs: 60_000, reason: "Late" }, headers),
    )
  ).json();
  vi.advanceTimersByTime(24 * 60 * 60_000);
  for (const [base, claimHandle] of [
    ["/api/agent-connections", pairing.claimHandle],
    ["/api/access-requests", request.claimHandle],
  ]) {
    expect(
      (await t.fetch(`${base}/cancel`, post({ claimHandle }, headers))).status,
    ).toBe(409);
    expect(
      await (await t.fetch(`${base}/status`, post({ claimHandle }))).json(),
    ).toMatchObject({ handoffStatus: "approval_timeout" });
  }
});

test("an operator decision cannot overwrite a revoked pending replacement", async () => {
  const { t, owner, invite, connection } = await setup();
  await t.fetch(
    "/api/agent-connections/ack",
    post({
      claimHandle: invite.claimHandle,
      agentConnectionSecret: connection.agentConnectionSecret,
    }),
  );
  const headers = {
    "x-agent-connection-id": connection.agentConnectionId,
    "x-agent-connection-secret": connection.agentConnectionSecret,
  };
  const pending = await (
    await t.fetch("/api/agent-connections", post({}, headers))
  ).json();
  const publicToken = pending.connectUrl.split("/connect/")[1];
  await t.fetch("/api/agent-connections/revoke", post({}, headers));
  for (const decision of ["approved", "denied"] as const) {
    await expect(
      owner.mutation(api.tables.agentConnections.decideInvite, {
        publicToken,
        decision,
      }),
    ).rejects.toThrow("no longer available");
  }
  expect(
    await (
      await t.fetch(
        pending.nextAction.path,
        post({ claimHandle: pending.claimHandle }),
      )
    ).json(),
  ).toMatchObject({ handoffStatus: "revoked", reason: "predecessor_revoked" });
});

test("idempotent request recovery cannot recover an already expired grant", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const { t, owner, userId, invite, connection } = await setup();
  await t.fetch(
    "/api/agent-connections/ack",
    post({
      claimHandle: invite.claimHandle,
      agentConnectionSecret: connection.agentConnectionSecret,
    }),
  );
  await t.mutation(
    internal.connect.connections.save,
    managedFixture({ userId, login: "owner", providerUserId: "1" }),
  );
  const account = (
    await owner.query(api.tables.connections.queries.statusesForApps, {
      apps: ["slack"],
    })
  )[0].accounts[0].id;
  const headers = {
    "x-agent-connection-id": connection.agentConnectionId,
    "x-agent-connection-secret": connection.agentConnectionSecret,
    "idempotency-key": "task-with-private-idempotency-key-12345",
  };
  const body = { apps: ["slack"], ttlMs: 1_000, reason: "Short task" };
  const request = await (
    await t.fetch("/api/access-requests", post(body, headers))
  ).json();
  await owner.mutation(api.tables.slices.sliceRequests.decide, {
    publicToken: request.approvalUrl.split("/requests/new/")[1],
    decision: "approved",
    bindings: [{ app: "slack", connectionId: account }],
  });
  vi.advanceTimersByTime(1_001);
  const retry = await t.fetch("/api/access-requests", post(body, headers));
  expect(retry.status).toBe(409);
  expect(await retry.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(
    await (
      await t.fetch(
        request.nextAction.path,
        post({ claimHandle: request.claimHandle }),
      )
    ).json(),
  ).toMatchObject({ handoffStatus: "slice_expired" });
});
