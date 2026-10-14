/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

afterEach(() => {
  vi.useRealTimers();
});

const web = {
  issuer: "https://api.workos.com/user_management/client_web",
  client_id: "client_web",
};

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ ...web, subject: "user_owner" });
  const stranger = t.withIdentity({ ...web, subject: "user_stranger" });
  const app = t.withIdentity({
    issuer: "https://auth.test",
    subject: "user_owner",
    client_id: "https://cursor.com/oauth/client.json",
  });
  await owner.mutation(api.accounts.save, {
    providerId: "github",
    connectorId: "conn_github",
    installationId: "T1",
    label: "acme",
  });
  const [account] = await owner.query(api.accounts.list, {});
  const request = async (argsHash = "h1") => {
    const result = await app.mutation(api.gateway.authorize, {
      tool: "github_add_issue_comment",
      summary: "Comment on acme/web#4",
      argsHash,
    });
    if (result.decision !== "waiting") throw new Error(result.decision);
    return result.approvalId;
  };
  const status = (id: Id<"approvals">) =>
    app.query(api.gateway.approvalStatus, { id });
  return { t, owner, stranger, app, account, request, status };
}

test("owner calls require the web app's client id", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t
      .withIdentity({
        ...web,
        subject: "user_owner",
        client_id: "client_other",
      })
      .query(api.clients.list, {}),
  ).rejects.toThrow("authority-invalid");
  await expect(
    t
      .withIdentity({
        issuer: "https://auth.test",
        subject: "user_owner",
        client_id: "client_web",
      })
      .query(api.clients.list, {}),
  ).rejects.toThrow("authority-invalid");
});

test("only the owner approves, and a timed approval ends with its window", async () => {
  vi.useFakeTimers();
  const { t, owner, stranger, account, request, status } = await setup();
  const id = await request();
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
  expect((await owner.query(api.approvals.open, {})).approved[0]).toMatchObject(
    { appName: "cursor.com", accountId: account._id },
  );
  vi.advanceTimersByTime(15 * 60_000);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await status(id)).toBe("expired");
});

test("pending requests expire after the decision window", async () => {
  vi.useFakeTimers();
  const { t, request, status } = await setup();
  const id = await request();
  vi.advanceTimersByTime(30 * 60_000);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await status(id)).toBe("expired");
});

test("ending an approval or disconnecting the account stops it", async () => {
  const { owner, account, request, status } = await setup();
  const approve = async (argsHash: string) => {
    const id = await request(argsHash);
    await owner.mutation(api.approvals.approve, {
      id,
      accountId: account._id,
      minutes: 30,
    });
    return id;
  };
  const ended = await approve("a");
  await owner.mutation(api.approvals.end, { id: ended });
  expect(await status(ended)).toBe("ended");

  const disconnected = await approve("b");
  await owner.mutation(api.accounts.remove, { id: account._id });
  expect(await status(disconnected)).toBe("ended");
});

test("notifications describe the call and offer approve once for a single account", async () => {
  const { t, owner, account, request } = await setup();
  const id = await request();
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
    title: "cursor.com wants GitHub: Comment on an issue or PR",
    body: "Comment on acme/web#4\nacme",
    quickApprove: true,
    approveLabel: "Approve once",
    approveMinutes: 0,
  });

  await owner.mutation(api.approvals.approve, { id, minutes: 0 });
  expect(await delivery()).toBeNull();

  const second = await request("other");
  await owner.mutation(api.accounts.remove, { id: account._id });
  await expect(
    owner.mutation(api.approvals.approve, { id: second, minutes: 0 }),
  ).rejects.toThrow("authority-invalid");
});

test("reconnecting with a different installation reports the replaced grant", async () => {
  const { owner } = await setup();
  const save = (installationId: string) =>
    owner.mutation(api.accounts.save, {
      providerId: "github",
      connectorId: "conn_github",
      installationId,
      label: "acme",
    });
  expect(
    await owner.mutation(api.accounts.save, {
      providerId: "github",
      connectorId: "conn_github",
      installationId: "T1",
      label: "acme",
      grantedScopes: ["repo"],
    }),
  ).toEqual({});
  expect((await owner.query(api.accounts.list, {}))[0].permissions).toEqual({
    scopes: ["repo"],
    checkedAt: expect.any(Number),
  });
  expect(await save("T1")).toEqual({});
  expect(
    (await owner.query(api.accounts.list, {}))[0].permissions,
  ).toBeUndefined();
  expect(await save("T2")).toEqual({
    replaced: { connectorId: "conn_github", installationId: "T1" },
  });
  expect(await owner.query(api.accounts.list, {})).toHaveLength(1);
});
