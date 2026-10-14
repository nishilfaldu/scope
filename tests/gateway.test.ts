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
      providerId: "github",
      connectorId: "conn_github",
      installationId: "T1",
      label: "acme",
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
  const result = await call(cursor, "github_list_issues");
  expect(result).toMatchObject({
    decision: "run",
    account: { ownerId: "user_owner", connectorId: "conn_github" },
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
      tool: "github_list_issues",
      decision: "allowed",
      outcome: "ok",
    },
  ]);
});

test("writes ask, and approving once covers only that exact call", async () => {
  const { owner, cursor, call } = await setup();
  const first = await call(cursor, "github_add_issue_comment", "hello");
  expect(first.decision).toBe("waiting");
  if (first.decision !== "waiting") throw new Error();
  expect(await call(cursor, "github_add_issue_comment", "hello")).toEqual(
    first,
  );

  const [pending] = (await owner.query(api.approvals.open, {})).pending;
  expect(pending).toMatchObject({
    appName: "cursor.com",
    tool: "github_add_issue_comment",
    reason: "Run github_add_issue_comment",
  });
  await owner.mutation(api.approvals.approve, {
    id: first.approvalId,
    minutes: 0,
  });
  expect(
    await cursor.query(api.gateway.approvalStatus, { id: first.approvalId }),
  ).toBe("approved");

  expect(
    (await call(cursor, "github_add_issue_comment", "other")).decision,
  ).toBe("waiting");
  expect(
    (await call(cursor, "github_add_issue_comment", "hello")).decision,
  ).toBe("run");
  expect(
    (await call(cursor, "github_add_issue_comment", "hello")).decision,
  ).toBe("waiting");
});

test("a timed approval covers any arguments until it ends", async () => {
  const { owner, cursor, call } = await setup();
  const first = await call(cursor, "github_add_issue_comment", "a");
  if (first.decision !== "waiting") throw new Error();
  await owner.mutation(api.approvals.approve, {
    id: first.approvalId,
    minutes: 15,
  });
  expect((await call(cursor, "github_add_issue_comment", "b")).decision).toBe(
    "run",
  );
  expect((await call(cursor, "github_add_issue_comment", "c")).decision).toBe(
    "run",
  );
});

test("a denied call is not asked again right away", async () => {
  const { owner, cursor, call } = await setup();
  const first = await call(cursor, "github_add_issue_comment");
  if (first.decision !== "waiting") throw new Error();
  await owner.mutation(api.approvals.deny, { id: first.approvalId });
  expect((await call(cursor, "github_add_issue_comment")).decision).toBe(
    "denied",
  );
  vi.advanceTimersByTime(3 * 60_000);
  expect((await call(cursor, "github_add_issue_comment")).decision).toBe(
    "waiting",
  );
});

test("rules apply per app", async () => {
  const { owner, app, cursor, call } = await setup();
  const claude = app("https://claude.ai/oauth/client.json");
  await call(cursor, "github_list_issues");
  await call(claude, "github_list_issues");
  const apps = await owner.query(api.clients.list, {});
  const cursorApp = apps.find((a) => a.name === "cursor.com")!;
  await owner.mutation(api.clients.setRule, {
    id: cursorApp._id,
    tool: "github_issue_read",
    rule: "block",
  });
  await owner.mutation(api.clients.setRule, {
    id: cursorApp._id,
    tool: "github_add_issue_comment",
    rule: "allow",
  });
  expect(await cursor.query(api.gateway.visibleTools, {})).not.toContain(
    "github_issue_read",
  );
  expect((await call(cursor, "github_issue_read")).decision).toBe("blocked");
  expect((await call(cursor, "github_add_issue_comment")).decision).toBe("run");
  expect((await call(claude, "github_issue_read")).decision).toBe("run");
  expect((await call(claude, "github_add_issue_comment")).decision).toBe(
    "waiting",
  );

  await owner.mutation(api.clients.setRule, {
    id: cursorApp._id,
    tool: "github_issue_read",
    rule: "allow",
  });
  expect(
    (await owner.query(api.clients.list, {})).find(
      (a) => a._id === cursorApp._id,
    )?.rules,
  ).toEqual({ github_add_issue_comment: "allow" });
});

test("revoking one app stops it and ends its approvals", async () => {
  const { owner, app, cursor, call } = await setup();
  const claude = app("https://claude.ai/oauth/client.json");
  const waiting = await call(cursor, "github_add_issue_comment");
  await call(claude, "github_list_issues");
  const cursorApp = (await owner.query(api.clients.list, {})).find(
    (a) => a.name === "cursor.com",
  )!;
  await owner.mutation(api.clients.revoke, { id: cursorApp._id });
  await expect(cursor.query(api.gateway.visibleTools, {})).rejects.toThrow(
    "client-revoked",
  );
  await expect(call(cursor, "github_list_issues")).rejects.toThrow(
    "client-revoked",
  );
  expect((await owner.query(api.approvals.open, {})).pending).toHaveLength(0);
  if (waiting.decision !== "waiting") throw new Error();
  expect((await call(claude, "github_list_issues")).decision).toBe("run");

  await owner.mutation(api.clients.restore, { id: cursorApp._id });
  expect((await call(cursor, "github_list_issues")).decision).toBe("run");
});

test("refused calls are logged once a minute", async () => {
  const { owner, cursor, call } = await setup();
  await call(cursor, "github_list_issues");
  const [app] = await owner.query(api.clients.list, {});
  const decisions = async () =>
    (
      await owner.query(api.activity.list, {
        paginationOpts: { numItems: 20, cursor: null },
      })
    ).page.map((c) => c.decision);

  await cursor.mutation(api.gateway.refused, {
    tool: "github_add_issue_comment",
  });
  expect(await decisions()).toEqual(["allowed"]);

  await owner.mutation(api.clients.setRule, {
    id: app._id,
    tool: "github_add_issue_comment",
    rule: "block",
  });
  await cursor.mutation(api.gateway.refused, {
    tool: "github_add_issue_comment",
  });
  await cursor.mutation(api.gateway.refused, {
    tool: "github_add_issue_comment",
  });
  expect(await decisions()).toEqual(["blocked", "allowed"]);

  await owner.mutation(api.clients.revoke, { id: app._id });
  await cursor.mutation(api.gateway.refused, {
    tool: "github_list_issues",
  });
  vi.advanceTimersByTime(61_000);
  await cursor.mutation(api.gateway.refused, {
    tool: "github_list_issues",
  });
  await cursor.mutation(api.gateway.refused, { tool: "unknown_tool" });
  expect(await decisions()).toEqual([
    "revoked",
    "revoked",
    "blocked",
    "allowed",
  ]);
});

test("a new request asks the gateway to describe it first", async () => {
  const { owner, cursor } = await setup();
  const request = { tool: "github_add_issue_comment", argsHash: "h1" };
  expect(
    await cursor.mutation(api.gateway.authorize, {
      tool: "github_list_issues",
      argsHash: "h1",
    }),
  ).toMatchObject({ decision: "run" });
  expect(await cursor.mutation(api.gateway.authorize, request)).toMatchObject({
    decision: "describe",
    account: { connectorId: "conn_github", installationId: "T1" },
  });
  expect((await owner.query(api.approvals.open, {})).pending).toHaveLength(0);
  const waiting = await cursor.mutation(api.gateway.authorize, {
    ...request,
    summary: "Comment on acme/web#4",
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

test("only tools for connected providers are listed", async () => {
  const { cursor } = await setup();
  const visible = await cursor.query(api.gateway.visibleTools, {});
  expect(visible).toContain("github_add_issue_comment");
  expect(visible.some((name) => name.startsWith("notion_"))).toBe(false);
});

test("without a connected account the call explains what to do", async () => {
  const { cursor, call } = await setup({ connect: false });
  expect((await call(cursor, "github_list_issues")).decision).toBe(
    "no-account",
  );
});
