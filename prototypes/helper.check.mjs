import test from "node:test";
import assert from "node:assert/strict";
import { listBases } from "../plugins/scope-local/helper.mjs";
const args = {
  accountId: "account-a",
  reason: "Read my bases",
  key: "task-key-123456789",
  waitSeconds: 0,
};
const config = {
  origin: "https://scope.example",
  accessToken: "synthetic-workos-token",
};
const token = "synthetic-provider-token-never-print";
function fixture({
  mismatch = false,
  echo = false,
  pending = false,
  expired = false,
} = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/request"))
      return Response.json({
        id: "request-a",
        approvalUrl: "https://scope.example/lab",
      });
    if (url.endsWith("/deliver"))
      return Response.json(
        pending
          ? { status: "pending" }
          : {
              status: "ready",
              accessToken: token,
              accountId: "account-a",
              providerUserId: "usr-a",
              expiresAt: Date.now() + (expired ? -1 : 3600_000),
            },
      );
    if (url.endsWith("/whoami"))
      return Response.json({ id: mismatch ? "usr-b" : "usr-a" });
    if (url.endsWith("/bases"))
      return Response.json({
        bases: [
          {
            id: "app-a",
            name: echo ? token : "A base",
            permissionLevel: "read",
            ignoredSecret: token,
          },
        ],
      });
    throw new Error("Unexpected endpoint");
  };
  return { fetcher, calls };
}
test("local helper uses bearer only for exact Airtable endpoints and emits only selected provider data", async () => {
  const f = fixture();
  const data = await listBases(args, { config, fetcher: f.fetcher });
  assert.equal(data.bases[0].name, "A base");
  assert.ok(!JSON.stringify(data).includes(token));
  assert.equal(
    f.calls.filter((c) => c.options.headers.Authorization === `Bearer ${token}`)
      .length,
    2,
  );
  assert.ok(f.calls.every((c) => c.options.redirect === "error"));
});
test("pending result is retryable using the exact key and contains no credential", async () => {
  const f = fixture({ pending: true });
  const result = await listBases(args, { config, fetcher: f.fetcher });
  assert.equal(result.status, "pending");
  assert.equal(result.retryKey, args.key);
  assert.equal(f.calls.length, 2);
});
test("wrong account, expired token and credential echoed in provider data fail closed", async () => {
  for (const options of [
    { mismatch: true },
    { expired: true },
    { echo: true },
  ]) {
    const f = fixture(options);
    await assert.rejects(listBases(args, { config, fetcher: f.fetcher }));
  }
});
