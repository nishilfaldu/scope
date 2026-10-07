/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "user_owner",
    client_id: "client_web",
  });
  const stranger = t.withIdentity({
    subject: "user_stranger",
    client_id: "client_web",
  });
  const { token } = await owner.mutation(api.agents.create, {
    name: "Research assistant",
  });
  await owner.mutation(api.accounts.save, {
    providerId: "slack",
    connectorId: "conn_slack",
    installationId: "T1",
    label: "Acme workspace",
  });
  const [account] = await owner.query(api.accounts.list, {});
  const request = () =>
    t.mutation(api.approvals.request, {
      token,
      providerId: "slack",
      reason: "Summarize public channels",
    });
  return { t, owner, stranger, token, account, request };
}

test("owner calls require the web app's client id", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t
      .withIdentity({ subject: "user_owner", client_id: "client_other" })
      .query(api.agents.list, {}),
  ).rejects.toThrow("authority-invalid");
});

test("agent tokens are the only agent authority", async () => {
  const { t, token, owner } = await setup();
  expect(await t.query(api.agents.whoami, { token })).toEqual({
    name: "Research assistant",
  });
  await expect(
    t.query(api.agents.whoami, { token: "scope_" + "0".repeat(64) }),
  ).rejects.toThrow("authority-invalid");
  const [agent] = await owner.query(api.agents.list, {});
  expect(agent).not.toHaveProperty("tokenHash");
});

test("a request needs a connected account and reuses the open request", async () => {
  const { t, token, owner, request } = await setup();
  await expect(
    t.mutation(api.approvals.request, {
      token,
      providerId: "github",
      reason: "Read issues",
    }),
  ).rejects.toThrow("no-account");
  await expect(
    t.mutation(api.approvals.request, {
      token,
      providerId: "unknown",
      reason: "Anything",
    }),
  ).rejects.toThrow("invalid-input");
  const first = await request(),
    second = await request();
  expect(second.id).toBe(first.id);
  expect(await owner.query(api.approvals.pendingCount, {})).toBe(1);
  const other = await owner.mutation(api.agents.create, { name: "Other" });
  const separate = await t.mutation(api.approvals.request, {
    token: other.token,
    providerId: "slack",
    reason: "Summarize public channels",
  });
  expect(separate.id).not.toBe(first.id);
});

test("only the owner approves, and claim works only inside the window", async () => {
  vi.useFakeTimers();
  const { t, owner, stranger, token, account, request } = await setup();
  const { id } = await request();
  await expect(t.mutation(api.approvals.claim, { token, id })).rejects.toThrow(
    "authority-invalid",
  );
  await expect(
    stranger.mutation(api.approvals.approve, {
      id,
      accountId: account._id,
      minutes: 15,
    }),
  ).rejects.toThrow("authority-invalid");
  await owner.mutation(api.approvals.approve, {
    id,
    accountId: account._id,
    minutes: 15,
  });
  const other = await owner.mutation(api.agents.create, { name: "Other" });
  await expect(
    t.mutation(api.approvals.claim, { token: other.token, id }),
  ).rejects.toThrow("authority-invalid");
  const claim = await t.mutation(api.approvals.claim, { token, id });
  expect(claim).toMatchObject({
    ownerId: "user_owner",
    providerId: "slack",
    connectorId: "conn_slack",
    installationId: "T1",
  });
  await t.mutation(api.approvals.claim, { token, id });
  expect((await owner.query(api.approvals.open, {})).approved[0]).toMatchObject(
    { collections: 2, agentName: "Research assistant" },
  );
  expect((await request()).id).toBe(id);
  vi.advanceTimersByTime(15 * 60_000);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.approvals.status, { token, id })).toMatchObject({
    status: "expired",
  });
  await expect(t.mutation(api.approvals.claim, { token, id })).rejects.toThrow(
    "authority-invalid",
  );
});

test("pending requests expire after the decision window", async () => {
  vi.useFakeTimers();
  const { t, token, request } = await setup();
  const { id } = await request();
  vi.advanceTimersByTime(30 * 60_000);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.query(api.approvals.status, { token, id })).status).toBe(
    "expired",
  );
});

test("ending, disconnecting or deleting the agent stops collection", async () => {
  const { t, owner, token, account, request } = await setup();
  const approve = async () => {
    const { id } = await request();
    await owner.mutation(api.approvals.approve, {
      id,
      accountId: account._id,
      minutes: 30,
    });
    return id;
  };
  const ended = await approve();
  await owner.mutation(api.approvals.end, { id: ended });
  await expect(
    t.mutation(api.approvals.claim, { token, id: ended }),
  ).rejects.toThrow();

  const disconnected = await approve();
  await owner.mutation(api.accounts.remove, { id: account._id });
  expect(
    (await t.query(api.approvals.status, { token, id: disconnected })).status,
  ).toBe("ended");

  const [agent] = await owner.query(api.agents.list, {});
  await owner.mutation(api.agents.remove, { id: agent._id });
  await expect(t.query(api.agents.whoami, { token })).rejects.toThrow(
    "authority-invalid",
  );
});

test("notifications describe the request and offer quick approval for a single account", async () => {
  vi.useFakeTimers();
  const { t, owner, account, request } = await setup();
  const { id } = await request();
  await owner.mutation(api.notifications.subscribe, {
    endpoint: "https://fcm.googleapis.com/fcm/send/device",
    p256dh: "key",
    auth: "secret",
  });
  const subscriptionId = await t.run(
    async (ctx) => (await ctx.db.query("pushSubscriptions").first())!._id,
  );
  const delivery = () =>
    t.query(internal.notifications.deliverySubscription, {
      approvalId: id,
      subscriptionId,
    });
  expect((await delivery())?.message).toEqual({
    title: "Research assistant wants Slack",
    body: "Summarize public channels\nAcme workspace",
    quickApprove: true,
  });
  await owner.mutation(api.accounts.save, {
    providerId: "slack",
    connectorId: "conn_slack",
    installationId: "T1",
    label: "Acme workspace",
    grantedScopes: ["channels:read", "channels:history", "chat:write", "x:y"],
  });
  expect((await delivery())?.message.body).toBe(
    "Summarize public channels\nAcme workspace\n" +
      "Can: See public channels; Read messages in public channels; Send messages (+1 more)",
  );

  await owner.mutation(api.approvals.approve, { id, minutes: 30 });
  const [approved] = (await owner.query(api.approvals.open, {})).approved;
  expect(approved).toMatchObject({ accountId: account._id });
  expect(await delivery()).toBeNull();

  const other = await owner.mutation(api.agents.create, { name: "Other" });
  const second = await t.mutation(api.approvals.request, {
    token: other.token,
    providerId: "slack",
    reason: "Read channels",
  });
  await owner.mutation(api.accounts.remove, { id: account._id });
  await expect(
    owner.mutation(api.approvals.approve, { id: second.id, minutes: 30 }),
  ).rejects.toThrow("authority-invalid");
});

test("reconnecting with a different installation reports the replaced grant", async () => {
  const { owner } = await setup();
  const save = (installationId: string) =>
    owner.mutation(api.accounts.save, {
      providerId: "slack",
      connectorId: "conn_slack",
      installationId,
      label: "Acme workspace",
    });
  expect(
    await owner.mutation(api.accounts.save, {
      providerId: "slack",
      connectorId: "conn_slack",
      installationId: "T1",
      label: "Acme workspace",
      grantedScopes: ["channels:read"],
    }),
  ).toEqual({});
  expect((await owner.query(api.accounts.list, {}))[0].permissions).toEqual({
    scopes: ["channels:read"],
    checkedAt: expect.any(Number),
  });
  expect(await save("T1")).toEqual({});
  expect(
    (await owner.query(api.accounts.list, {}))[0].permissions,
  ).toBeUndefined();
  expect(await save("T2")).toEqual({
    replaced: { connectorId: "conn_slack", installationId: "T1" },
  });
  expect(await owner.query(api.accounts.list, {})).toHaveLength(1);
});
