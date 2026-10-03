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

test("shared PAT uses WorkOS auth, labels unverified expiry and rejects extra bases", async () => {
  const f = fixture();
  const cfg = {
    origin: config.origin,
    accessToken: "synthetic-workos-token",
  };
  let extraBase = false;
  const fetcher = async (url, options) => {
    const response = await f.fetcher(url, options);
    const body = await response.json();
    if (url.endsWith("/deliver"))
      Object.assign(body, {
        credentialKind: "shared-pat",
        baseId: "app2SVjDmWa26jwo6",
        providerExpiresAt: null,
        approvalExpiresAt: Date.now() + 60_000,
      });
    if (url.endsWith("/bases"))
      body.bases = [
        {
          id: "app2SVjDmWa26jwo6",
          name: "Scope Prototype Test",
          permissionLevel: "read",
        },
        ...(extraBase ? [{ id: "unapproved-base", name: "Other" }] : []),
      ];
    return Response.json(body);
  };
  const result = await listBases(args, { config: cfg, fetcher });
  assert.equal(result.providerExpiresAt, null);
  assert.equal(result.credentialKind, "shared-pat");
  assert.equal(
    f.calls[0].options.headers.Authorization,
    "Bearer synthetic-workos-token",
  );
  assert.ok(!JSON.stringify(result).includes(token));
  extraBase = true;
  await assert.rejects(
    listBases(args, { config: cfg, fetcher }),
    /Unexpected PAT base scope/,
  );
});

test("helper confirms private receipt before provider work and preserves retry after acknowledgement failure", async () => {
  const f = fixture();
  let failAck = true;
  const steps = [];
  const fetcher = async (url, options) => {
    steps.push(url);
    if (url.endsWith("/ack")) {
      assert.equal(
        options.headers.Authorization,
        `Bearer ${config.accessToken}`,
      );
      assert.deepEqual(JSON.parse(options.body), {
        id: "request-a",
        receiptId: "private-receipt",
      });
      return Response.json({ received: true }, { status: failAck ? 503 : 200 });
    }
    const response = await f.fetcher(url, options);
    if (url.endsWith("/deliver"))
      return Response.json({
        ...(await response.json()),
        receiptId: "private-receipt",
      });
    return response;
  };
  await assert.rejects(listBases(args, { config, fetcher }));
  assert.ok(!steps.some((url) => url.includes("api.airtable.com")));
  failAck = false;
  steps.length = 0;
  const output = await listBases(args, { config, fetcher });
  assert.ok(
    steps.findIndex((url) => url.endsWith("/ack")) <
      steps.findIndex((url) => url.endsWith("/whoami")),
  );
  assert.ok(!JSON.stringify(output).includes("private-receipt"));
});

test("two PAT accounts use the delivered base binding and reject cross-account results", async () => {
  for (const id of ["A", "B"]) {
    let wrongIdentity = false,
      wrongBase = false;
    const fetcher = async (url) => {
      if (url.endsWith("/request"))
        return Response.json({ id: "request-" + id });
      if (url.endsWith("/deliver"))
        return Response.json({
          status: "ready",
          accountId: "account-" + id,
          providerUserId: "usr" + id,
          baseId: "appBase" + id,
          accessToken: token,
          expiresAt: Date.now() + 60_000,
          approvalExpiresAt: Date.now() + 60_000,
          providerExpiresAt: null,
          credentialKind: "shared-pat",
        });
      if (url.endsWith("/whoami"))
        return Response.json({ id: wrongIdentity ? "usrOther" : "usr" + id });
      if (url.endsWith("/bases"))
        return Response.json({
          bases: [
            {
              id: wrongBase ? "appOther" : "appBase" + id,
              name: "Account " + id,
              permissionLevel: "read",
            },
          ],
        });
      throw new Error("Unexpected endpoint");
    };
    const requestArgs = { ...args, accountId: "account-" + id };
    const result = await listBases(requestArgs, { config, fetcher });
    assert.equal(result.bases[0].id, "appBase" + id);
    assert.equal(result.providerUserId, "usr" + id);
    assert.ok(!JSON.stringify(result).includes(token));
    wrongIdentity = true;
    await assert.rejects(
      listBases(requestArgs, { config, fetcher }),
      /Airtable account mismatch/,
    );
    wrongIdentity = false;
    wrongBase = true;
    await assert.rejects(
      listBases(requestArgs, { config, fetcher }),
      /Unexpected PAT base scope/,
    );
  }
});
