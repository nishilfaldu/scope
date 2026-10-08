/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup({ connect = true } = {}) {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    issuer: "https://api.workos.com/user_management/client_web",
    client_id: "client_web",
    subject: "user_owner",
  });
  const app = (clientKey: string) =>
    t.withIdentity({
      issuer: "https://auth.test",
      subject: "user_owner",
      client_id: clientKey,
    });
  if (connect)
    await owner.mutation(api.accounts.save, {
      providerId: "slack",
      connectorId: "conn_slack",
      installationId: "T1",
      label: "Acme workspace",
    });
  const cursor = app("https://cursor.com/oauth/client.json");
  const call = (
    client: ReturnType<typeof app>,
    tool: string,
    argsHash = "h1",
  ) =>
    client.mutation(api.gateway.authorize, {
      tool,
      summary: `Run ${tool}`,
      argsHash,
    });
  return { t, owner, app, cursor, call };
}

test("app tokens and web sessions cannot stand in for each other", async () => {
  const { owner, cursor } = await setup();
  await expect(cursor.query(api.clients.list, {})).rejects.toThrow(
    "authority-invalid",
  );
  await expect(owner.query(api.gateway.visibleTools, {})).rejects.toThrow(
    "authority-invalid",
  );
});

test("reads run by default and are logged without content", async () => {
  const { owner, cursor, call } = await setup();
  const result = await call(cursor, "slack_list_channels");
  expect(result).toMatchObject({
    decision: "run",
    account: { ownerId: "user_owner", connectorId: "conn_slack" },
  });
  if (result.decision !== "run") throw new Error();
  await cursor.mutation(api.gateway.finish, {
    callId: result.callId,
    outcome: "ok",
  });
  const [app] = await owner.query(api.clients.list, {});
  expect(app).toMatchObject({ name: "cursor.com", rules: {} });
  const { page } = await owner.query(api.activity.list, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page).toMatchObject([
    {
      clientName: "cursor.com",
      tool: "slack_list_channels",
      decision: "allowed",
      outcome: "ok",
    },
  ]);
});

test("writes ask, and approving once covers only that exact call", async () => {
  const { owner, cursor, call } = await setup();
  const first = await call(cursor, "slack_post_message", "hello");
  expect(first.decision).toBe("waiting");
  if (first.decision !== "waiting") throw new Error();
  expect(await call(cursor, "slack_post_message", "hello")).toEqual(first);

  const [pending] = (await owner.query(api.approvals.open, {})).pending;
  expect(pending).toMatchObject({
    agentName: "cursor.com",
    tool: "slack_post_message",
    reason: "Run slack_post_message",
  });
  await owner.mutation(api.approvals.approve, {
    id: first.approvalId,
    minutes: 0,
  });
  expect(
    await cursor.query(api.gateway.approvalStatus, { id: first.approvalId }),
  ).toBe("approved");

  expect((await call(cursor, "slack_post_message", "other")).decision).toBe(
    "waiting",
  );
  expect((await call(cursor, "slack_post_message", "hello")).decision).toBe(
    "run",
  );
  expect((await call(cursor, "slack_post_message", "hello")).decision).toBe(
    "waiting",
  );
});

test("a timed approval covers any arguments until it ends", async () => {
  const { owner, cursor, call } = await setup();
  const first = await call(cursor, "slack_post_message", "a");
  if (first.decision !== "waiting") throw new Error();
  await owner.mutation(api.approvals.approve, {
    id: first.approvalId,
    minutes: 15,
  });
  expect((await call(cursor, "slack_post_message", "b")).decision).toBe("run");
  expect((await call(cursor, "slack_post_message", "c")).decision).toBe("run");
});

test("a denied call is not asked again right away", async () => {
  const { owner, cursor, call } = await setup();
  const first = await call(cursor, "slack_post_message");
  if (first.decision !== "waiting") throw new Error();
  await owner.mutation(api.approvals.deny, { id: first.approvalId });
  expect((await call(cursor, "slack_post_message")).decision).toBe("denied");
  vi.advanceTimersByTime(3 * 60_000);
  expect((await call(cursor, "slack_post_message")).decision).toBe("waiting");
});

test("rules apply per app", async () => {
  const { owner, app, cursor, call } = await setup();
  const claude = app("https://claude.ai/oauth/client.json");
  await call(cursor, "slack_list_channels");
  await call(claude, "slack_list_channels");
  const apps = await owner.query(api.clients.list, {});
  const cursorApp = apps.find((a) => a.name === "cursor.com")!;
  await owner.mutation(api.clients.setRule, {
    id: cursorApp._id,
    tool: "slack_read_history",
    rule: "block",
  });
  await owner.mutation(api.clients.setRule, {
    id: cursorApp._id,
    tool: "slack_post_message",
    rule: "allow",
  });
  expect(await cursor.query(api.gateway.visibleTools, {})).not.toContain(
    "slack_read_history",
  );
  expect((await call(cursor, "slack_read_history")).decision).toBe("blocked");
  expect((await call(cursor, "slack_post_message")).decision).toBe("run");
  expect((await call(claude, "slack_read_history")).decision).toBe("run");
  expect((await call(claude, "slack_post_message")).decision).toBe("waiting");

  await owner.mutation(api.clients.setRule, {
    id: cursorApp._id,
    tool: "slack_read_history",
    rule: "allow",
  });
  expect(
    (await owner.query(api.clients.list, {})).find(
      (a) => a._id === cursorApp._id,
    )?.rules,
  ).toEqual({ slack_post_message: "allow" });
});

test("revoking one app stops it and ends its approvals", async () => {
  const { owner, app, cursor, call } = await setup();
  const claude = app("https://claude.ai/oauth/client.json");
  const waiting = await call(cursor, "slack_post_message");
  await call(claude, "slack_list_channels");
  const cursorApp = (await owner.query(api.clients.list, {})).find(
    (a) => a.name === "cursor.com",
  )!;
  await owner.mutation(api.clients.revoke, { id: cursorApp._id });
  await expect(cursor.query(api.gateway.visibleTools, {})).rejects.toThrow(
    "client-revoked",
  );
  await expect(call(cursor, "slack_list_channels")).rejects.toThrow(
    "client-revoked",
  );
  expect((await owner.query(api.approvals.open, {})).pending).toHaveLength(0);
  if (waiting.decision !== "waiting") throw new Error();
  expect((await call(claude, "slack_list_channels")).decision).toBe("run");

  await owner.mutation(api.clients.restore, { id: cursorApp._id });
  expect((await call(cursor, "slack_list_channels")).decision).toBe("run");
});

test("a new request asks the gateway to describe it first", async () => {
  const { owner, cursor } = await setup();
  const request = { tool: "slack_post_message", argsHash: "h1" };
  expect(
    await cursor.mutation(api.gateway.authorize, {
      tool: "slack_list_channels",
      argsHash: "h1",
    }),
  ).toMatchObject({ decision: "run" });
  expect(await cursor.mutation(api.gateway.authorize, request)).toMatchObject({
    decision: "describe",
    account: { connectorId: "conn_slack", installationId: "T1" },
  });
  expect((await owner.query(api.approvals.open, {})).pending).toHaveLength(0);
  const waiting = await cursor.mutation(api.gateway.authorize, {
    ...request,
    summary: "Post in #general",
  });
  expect(waiting.decision).toBe("waiting");
  expect(await cursor.mutation(api.gateway.authorize, request)).toEqual(
    waiting,
  );
});

test("the app's name comes from MCP initialize", async () => {
  const { owner, cursor } = await setup();
  await cursor.mutation(api.gateway.hello, { name: "cursor-vscode" });
  expect((await owner.query(api.clients.list, {}))[0].name).toBe("Cursor");
  await cursor.mutation(api.gateway.hello, { name: "My agent" });
  expect((await owner.query(api.clients.list, {}))[0].name).toBe("My agent");
});

test("without a connected account the call explains what to do", async () => {
  const { cursor, call } = await setup({ connect: false });
  expect((await call(cursor, "slack_list_channels")).decision).toBe(
    "no-account",
  );
});
