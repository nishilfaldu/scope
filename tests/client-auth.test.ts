import { beforeAll, expect, test } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyClient } from "../lib/client-auth";
let pair: Awaited<ReturnType<typeof generateKeyPair>>,
  keys: ReturnType<typeof createLocalJWKSet>;
const webClientId = "client_web",
  clientId = "client_cli",
  issuer = "https://api.workos.com/user_management/client_web";
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
    sub: "user_one",
    client_id: "client_cli",
    sid: "session_one",
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(key);
}
const options = () => ({ webClientId, clientId, keys });
test("signed AuthKit device session maps to an immutable WorkOS principal", async () => {
  expect(await verifyClient(await signed(), options())).toEqual({
    issuer,
    subject: "user_one",
    clientId: "client_cli",
    sessionId: "session_one",
  });
});
test("wrong environment, authenticating application, expiry and missing session claims are rejected", async () => {
  for (const override of [
    { iss: "https://other.example" },
    { client_id: webClientId },
    { client_id: "client_other" },
    { exp: 1 },
    { sid: undefined },
    { sid: " " },
    { client_id: undefined },
    { client_id: "" },
  ])
    await expect(
      verifyClient(await signed(override), options()),
    ).rejects.toThrow();
});
test("legacy Standalone and malformed user subjects are rejected", async () => {
  for (const sub of ["scope:owner", "user_", "user_one:extra", "user_ one"])
    await expect(
      verifyClient(await signed({ sub }), options()),
    ).rejects.toThrow();
});
test("wrong signatures cannot choose an owner, requester", async () => {
  const wrong = await generateKeyPair("RS256");
  await expect(
    verifyClient(await signed({}, wrong.privateKey), options()),
  ).rejects.toThrow();
});
test("same WorkOS user retains distinct device sessions", async () => {
  const a = await verifyClient(await signed(), options());
  const b = await verifyClient(await signed({ sid: "session_two" }), options());
  expect(a.subject).toBe(b.subject);
  expect(a.sessionId).not.toBe(b.sessionId);
});
