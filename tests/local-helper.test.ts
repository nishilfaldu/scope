// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { listBases, listChannels } from "../plugins/scope-local/helper.mjs";
const token = "synthetic-provider-never-print";
const args = {
  accountId: "account",
  reason: "Read bases",
  key: "task-key-123456789",
  waitSeconds: 0,
};
const session = async () => ({
  origin: "https://scope.example",
  accessToken: "synthetic-client",
});
const context = {
  id: "request",
  accountId: "account",
  integrationId: "airtable-rest-read",
  profileId: "bases.read",
  profileVersion: 1,
  grantVersion: 2,
  requesterConnectionId: "native",
  collectorConnectionId: "helper",
  intent: "List the available Airtable bases",
  approvalExpiresAt: Date.now() + 60_000,
  status: "approved",
};
let provider401: number,
  failReceipt: boolean,
  echo: boolean,
  expired: boolean,
  mismatch: boolean,
  pending: boolean;
const fetcher = vi.fn(async (url: string, options: RequestInit) => {
  expect(options.redirect).toBe("error");
  if (url.endsWith("/request"))
    return Response.json({
      id: "request",
      approvalUrl: "https://scope.example/approvals?request=request",
    });
  if (url.endsWith("/status"))
    return Response.json({
      ...context,
      status: pending ? "pending" : "approved",
    });
  if (url.endsWith("/deliver"))
    return Response.json({
      ...context,
      status: "ready",
      requestId: "request",
      accountId: mismatch ? "other" : context.accountId,
      accessToken: token,
      providerExpiresAt: Date.now() + (expired ? -1 : 3600_000),
      receiptProof: "private-receipt",
    });
  if (url.endsWith("/receipt"))
    return Response.json(
      { received: true },
      { status: failReceipt ? 503 : 200 },
    );
  if (url === "https://api.airtable.com/v0/meta/bases") {
    if (provider401-- > 0) return new Response(null, { status: 401 });
    return Response.json({
      bases: [
        {
          id: "app",
          name: echo ? token : "A base",
          permissionLevel: "read",
          ignoredSecret: token,
        },
      ],
    });
  }
  throw new Error("Unexpected endpoint");
});
beforeEach(() => {
  provider401 = 0;
  failReceipt = echo = expired = mismatch = pending = false;
  fetcher.mockClear();
});
test("provider credentials go only to fixed REST endpoints and tool output contains selected data", async () => {
  const output = await listBases(args, { session, fetcher });
  expect(output.bases).toEqual([
    { id: "app", name: "A base", permissionLevel: "read" },
  ]);
  expect(JSON.stringify(output)).not.toContain(token);
  expect(
    fetcher.mock.calls
      .filter(
        ([, o]) =>
          (o.headers as Record<string, string>).Authorization ===
          `Bearer ${token}`,
      )
      .map(([u]) => u),
  ).toEqual(["https://api.airtable.com/v0/meta/bases"]);
  expect(fetcher.mock.calls.every(([, o]) => o.redirect === "error")).toBe(
    true,
  );
});
test("pending returns a stable request ID and no provider acquisition", async () => {
  pending = true;
  expect(await listBases(args, { session, fetcher })).toMatchObject({
    status: "pending",
    requestId: "request",
  });
  expect(fetcher.mock.calls.some(([u]) => u.endsWith("/deliver"))).toBe(false);
});
test("wrong account, expired credential and echoed credential fail closed", async () => {
  for (const scenario of ["mismatch", "expired", "echo"]) {
    mismatch = scenario === "mismatch";
    expired = scenario === "expired";
    echo = scenario === "echo";
    await expect(listBases(args, { session, fetcher })).rejects.toThrow();
  }
});
test("receipt failure prevents provider work and a retry reuses the same request", async () => {
  failReceipt = true;
  await expect(listBases(args, { session, fetcher })).rejects.toThrow();
  expect(fetcher.mock.calls.some(([u]) => u.includes("api.airtable.com"))).toBe(
    false,
  );
  failReceipt = false;
  await listBases({ ...args, requestId: "request" }, { session, fetcher });
  expect(
    fetcher.mock.calls.filter(([u]) => u.endsWith("/request")),
  ).toHaveLength(1);
});
test("safe read reacquires at most once after 401 and never retries 403", async () => {
  provider401 = 2;
  await expect(listBases(args, { session, fetcher })).rejects.toThrow();
  expect(
    fetcher.mock.calls.filter(([u]) => u.endsWith("/deliver")),
  ).toHaveLength(2);
  fetcher.mockClear();
  const denied = async (u: string, o: RequestInit) =>
    u.includes("api.airtable.com")
      ? new Response(null, { status: 403 })
      : fetcher(u, o);
  await expect(listBases(args, { session, fetcher: denied })).rejects.toThrow();
  expect(
    fetcher.mock.calls.filter(([u]) => u.endsWith("/deliver")),
  ).toHaveLength(1);
});
test("a hosted request for another operation cannot be collected by this read helper", async () => {
  await expect(
    listChannels({ ...args, requestId: "request" }, { session, fetcher }),
  ).rejects.toThrow("Request does not match");
  expect(fetcher.mock.calls.some(([u]) => u.endsWith("/deliver"))).toBe(false);
});
