import { beforeAll, expect, test, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyRequester } from "../lib/probe-workos";

let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let keys: ReturnType<typeof createLocalJWKSet>;
const issuer = "https://auth.scope.example";
const resource = "https://scope.example/api/probe/mcp";
beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test" }],
  });
});
async function signed(
  overrides: Record<string, unknown> = {},
  key = pair.privateKey,
) {
  return new SignJWT({
    iss: issuer,
    aud: resource,
    sub: "user_one",
    client_id: "client_one",
    sid: "consent_one",
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(key);
}
function options() {
  return {
    issuer,
    resource,
    keys,
    getUser: vi.fn(async () => ({
      id: "user_one",
      external_id: "scope:owner_one",
    })),
  };
}
test("signed OAuth identity is mapped through WorkOS to an existing Convex owner", async () => {
  const opts = options();
  expect(await verifyRequester(await signed(), opts)).toEqual({
    userId: "owner_one",
    requester: "user_one:client_one:consent_one",
  });
  expect(opts.getUser).toHaveBeenCalledWith("user_one");
});
test("Standalone Connect uses the verified external subject without a User Management lookup", async () => {
  const opts = options();
  expect(
    await verifyRequester(await signed({ sub: "scope:owner_one" }), opts),
  ).toEqual({
    userId: "owner_one",
    requester: "scope:owner_one:client_one:consent_one",
  });
  expect(opts.getUser).not.toHaveBeenCalled();
});
test("Standalone subjects still require signed claims, the right resource and a nonempty owner", async () => {
  const opts = options();
  for (const override of [
    { sub: "scope:" },
    { sub: "scope:owner:extra" },
    { sub: "scope: owner" },
    { sub: "scope:owner_one", aud: "https://other.example" },
    { sub: "scope:owner_one", iss: "https://other.example" },
    { sub: "scope:owner_one", exp: 1 },
    { sub: "scope:owner_one", sid: undefined },
    { sub: "scope:owner_one", client_id: undefined },
  ])
    await expect(
      verifyRequester(await signed(override), opts),
    ).rejects.toThrow();
  const wrong = await generateKeyPair("RS256");
  await expect(
    verifyRequester(
      await signed({ sub: "scope:owner_one" }, wrong.privateKey),
      opts,
    ),
  ).rejects.toThrow();
  expect(opts.getUser).not.toHaveBeenCalled();
});
test("wrong resource, issuer, expiry, missing consent and bad signatures fail before lookup", async () => {
  const opts = options();
  for (const override of [
    { aud: "https://other.example" },
    { iss: "https://other.example" },
    { exp: 1 },
    { sid: undefined },
    { client_id: "" },
  ]) {
    await expect(
      verifyRequester(await signed(override), opts),
    ).rejects.toThrow();
  }
  const wrong = await generateKeyPair("RS256");
  await expect(
    verifyRequester(await signed({}, wrong.privateKey), opts),
  ).rejects.toThrow();
  expect(opts.getUser).not.toHaveBeenCalled();
});
test("unlinked and mismatched WorkOS records fail instead of accepting caller supplied owners", async () => {
  for (const user of [
    { id: "user_other", external_id: "scope:owner_one" },
    { id: "user_one", external_id: "scope:" },
    { id: "user_one", external_id: "unlinked" },
  ]) {
    await expect(
      verifyRequester(await signed(), {
        ...options(),
        getUser: async () => user,
      }),
    ).rejects.toThrow("Unlinked identity");
  }
});
