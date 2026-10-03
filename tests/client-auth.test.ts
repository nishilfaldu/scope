import { beforeAll, expect, test } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyClient } from "../lib/client-auth";
let pair: Awaited<ReturnType<typeof generateKeyPair>>,
  keys: ReturnType<typeof createLocalJWKSet>;
const issuer = "https://auth.scope.example",
  resource = "http://localhost:3000/api/mcp";
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
    sub: "scope:owner_one",
    client_id: "client_one",
    sid: "consent_one",
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(key);
}
const options = () => ({ issuer, resource, keys });
test("signed Standalone consent maps to a complete client principal without a second user directory", async () => {
  expect(await verifyClient(await signed(), options())).toEqual({
    userId: "owner_one",
    issuer,
    subject: "scope:owner_one",
    clientId: "client_one",
    consentId: "consent_one",
  });
});
test("invalid issuer, exact audience, expiry and missing/empty consent claims are rejected", async () => {
  for (const override of [
    { iss: "https://other.example" },
    { aud: "http://localhost:3000/api/probe/mcp" },
    { aud: "http://localhost:3000/api/mcp/" },
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
test("User Management subjects and malformed standalone subjects are not alternate authorization paths", async () => {
  for (const sub of ["user_one", "scope:", "scope:owner:extra", "scope: owner"])
    await expect(
      verifyClient(await signed({ sub }), options()),
    ).rejects.toThrow();
});
test("wrong signatures cannot choose an owner, requester or collector", async () => {
  const wrong = await generateKeyPair("RS256");
  await expect(
    verifyClient(await signed({}, wrong.privateKey), options()),
  ).rejects.toThrow();
});
test("renaming a display identity cannot merge distinct client consents", async () => {
  const a = await verifyClient(await signed(), options());
  const b = await verifyClient(await signed({ sid: "consent_two" }), options());
  expect(a.userId).toBe(b.userId);
  expect(a.consentId).not.toBe(b.consentId);
});
