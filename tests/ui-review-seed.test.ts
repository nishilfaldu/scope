import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { reviewRequests } from "../scripts/seed-ui-review.mjs";
import {
  approvalStatus,
  requestActivity,
  type ApprovalRequest,
} from "../lib/approval-display";
const modules = import.meta.glob("../convex/**/*.ts");
const ownerId = "user_review";
beforeEach(() => {
  vi.stubEnv("CONVEX_CLOUD_URL", "https://bright-dinosaur-692.convex.cloud");
  vi.stubEnv("WORKOS_CLIENT_ID", "web-client");
});
async function fixture() {
  const t = convexTest(schema, modules);
  const realId = await t.run((ctx) =>
    ctx.db.insert("clientConnections", {
      ownerId,
      subject: ownerId,
      issuer: "https://api.workos.com/user_management/web-client",
      clientId: "cli-client",
      sessionId: "session_real",
      name: "Existing connection",
    }),
  );
  const accountId = await t.run((ctx) =>
    ctx.db.insert("connectedAccounts", {
      ownerId,
      providerId: "slack",
      providerName: "Slack",
      label: "Existing account",
      accessDescription: "Existing permissions",
      providerUserId: "existing-user",
      connect: {
        issuer: "https://existing.example",
        connectorId: "existing",
        subjectId: "existing",
      },
      authorizationKey: "existing",
      grantVersion: 1,
      state: "active",
      grantedScopes: ["channels:read"],
    }),
  );
  const requestId = await t.run((ctx) =>
    ctx.db.insert("approvalRequests", {
      ownerId,
      accountId,
      requesterConnectionId: realId,
      key: "existing-request",
      providerId: "slack",
      grantVersion: 1,
      reason: "Existing request",
      snapshot: {
        accountLabel: "Existing account",
        providerName: "Slack",
        accessDescription: "Existing permissions",
        requesterName: "Existing connection",
        grantedScopes: ["channels:read"],
      },
      command: {
        argv: ["node", "existing.mjs"],
        cwd: "/tmp",
        envVar: "SLACK_TOKEN",
      },
      status: "denied",
      approvalExpiresAt: Date.now() - 1000,
    }),
  );
  return { t, realId, accountId, requestId };
}
test("review seed preserves real records and resets only its own fixtures", async () => {
  const { t, realId, accountId, requestId } = await fixture();
  const first = await t.mutation(internal.uiReview.prepare, { ownerId });
  const rows = reviewRequests(ownerId, first, Date.now());
  await t.run(async (ctx) => {
    for (const request of rows) {
      const row = { ...request };
      Reflect.deleteProperty(row, "_creationTime");
      await ctx.db.insert("approvalRequests", row);
    }
    await ctx.db.patch("clientConnections", first.agents.research, {
      name: "Edited demo",
      stoppedAt: Date.now(),
    });
  });
  const second = await t.mutation(internal.uiReview.prepare, { ownerId });
  expect(second).toEqual(first);
  await t.run(async (ctx) => {
    expect((await ctx.db.get("clientConnections", realId))?.name).toBe(
      "Existing connection",
    );
    expect(await ctx.db.query("connectedAccounts").take(100)).toHaveLength(6);
    expect(await ctx.db.query("clientConnections").take(100)).toHaveLength(5);
    expect(await ctx.db.query("approvalRequests").take(100)).toHaveLength(1);
    expect((await ctx.db.get("connectedAccounts", accountId))?.label).toBe(
      "Existing account",
    );
    expect((await ctx.db.get("approvalRequests", requestId))?.reason).toBe(
      "Existing request",
    );
    const demo = await ctx.db.get("clientConnections", first.agents.research);
    expect(demo?.name).toBe("Demo · Research assistant");
    expect(demo?.stoppedAt).toBeUndefined();
  });
});
test("seed refuses other deployments without writing anything", async () => {
  const { t } = await fixture();
  vi.stubEnv("CONVEX_CLOUD_URL", "https://production.example.convex.cloud");
  await expect(
    t.mutation(internal.uiReview.prepare, { ownerId }),
  ).rejects.toThrow("restricted to personal dev");
  await t.run(async (ctx) => {
    expect(await ctx.db.query("connectedAccounts").take(100)).toHaveLength(1);
  });
});
test("fixtures cover decisions, delivery, expiry, stops and pagination with chronological events", () => {
  const now = Date.now();
  const rows = reviewRequests(
    ownerId,
    {
      accounts: {
        active: "active",
        long: "long",
        disconnected: "disconnected",
      },
      agents: {
        research: "research",
        release: "release",
        long: "long",
        stopped: "stopped",
      },
    },
    now,
  );
  expect(rows).toHaveLength(29);
  const statuses = new Set();
  for (const row of rows) {
    const r = {
      ...row,
      _id: "request",
      createdAt: row._creationTime,
      deliveredAt: row.firstDeliveryAt,
      accountAvailable: row.accountId !== "disconnected",
      accountBlockedAt:
        row.accountId === "disconnected" ? now - 6 * 60_000 : undefined,
      requesterStopped: row.requesterConnectionId === "stopped",
      requesterStoppedAt:
        row.requesterConnectionId === "stopped" ? now - 5 * 60_000 : undefined,
    } as unknown as ApprovalRequest;
    statuses.add(approvalStatus(r));
    const times = requestActivity(r).flatMap((e) =>
      e.at === undefined ? [] : [e.at],
    );
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(r.snapshot.requesterName).toMatch(/^Demo · /);
  }
  expect(statuses).toEqual(
    new Set([
      "Needs approval",
      "Waiting for pickup",
      "Waiting for receipt",
      "Received",
      "Denied",
      "Expired",
      "Not collected",
      "Receipt unconfirmed",
      "Delivery stopped",
      "Not decided",
    ]),
  );
  expect(
    rows.filter(
      (r) =>
        r.status === "pending" &&
        r.approvalExpiresAt > now &&
        r.accountId !== "disconnected" &&
        r.requesterConnectionId !== "stopped",
    ),
  ).toHaveLength(3);
});
test("seeded pending decisions appear through the normal owner query", async () => {
  const { t } = await fixture();
  const bindings = await t.mutation(internal.uiReview.prepare, { ownerId });
  await t.run(async (ctx) => {
    for (const request of reviewRequests(ownerId, bindings)) {
      const row = { ...request };
      Reflect.deleteProperty(row, "_creationTime");
      await ctx.db.insert("approvalRequests", row);
    }
  });
  const owner = t.withIdentity({
    subject: ownerId,
    issuer: "https://api.workos.com/user_management/web-client",
    client_id: "web-client",
    sid: "session_browser",
  });
  const pending = await owner.query(api.approvals.pendingForOwner, {});
  expect(
    pending.filter((r) => r.accountAvailable && !r.requesterStopped),
  ).toHaveLength(3);
  const request = pending.find(
    (r) => r.accountAvailable && !r.requesterStopped,
  )!;
  await owner.mutation(api.approvals.decide, {
    id: request._id,
    approve: true,
  });
  const page = await owner.query(api.approvals.forOwner, {
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(page.page).toHaveLength(20);
  expect(page.isDone).toBe(false);
});
