import { ConvexHttpClient } from "convex/browser";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { createRemoteJWKSet } from "jose";
import { verifyRequester } from "./probe-workos";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { getTokenResponse } from "@vercel/connect";
import { api } from "@/convex/_generated/api";
import type { Id, Doc } from "@/convex/_generated/dataModel";

export function config(name: string) {
  if (process.env.VERCEL_ENV === "production")
    throw new Error("Prototype disabled in production");
  if (
    name === "SCOPE_PROBE_ORIGIN" &&
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_URL
  )
    return `https://${process.env.VERCEL_URL}`;
  const value = process.env[name];
  if (!value) throw new Error("Prototype setup incomplete");
  return value;
}
export function db() {
  return new ConvexHttpClient(config("NEXT_PUBLIC_CONVEX_URL"));
}
export async function ownerDb() {
  const client = db();
  const token = await convexAuthNextjsToken();
  if (!token) throw new Error("Sign in required");
  client.setAuth(token);
  return client;
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== config("SCOPE_PROBE_ORIGIN"))
    throw new Error("Origin rejected");
}
export const safeError = () =>
  Response.json(
    { error: "Prototype unavailable; check sign-in and setup" },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
export function json(value: unknown) {
  return Response.json(value, { headers: { "Cache-Control": "no-store" } });
}
export async function requester(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error("Unauthorized");
  const issuer = config("WORKOS_ISSUER");
  const resource = config("SCOPE_PROBE_ORIGIN") + "/api/probe/mcp";
  const identity = await verifyRequester(token, {
    issuer,
    resource,
    keys: createRemoteJWKSet(new URL("/oauth2/jwks", issuer)),
    getUser: async (id) => {
      const response = await fetch(
        `https://api.workos.com/user_management/users/${encodeURIComponent(id)}`,
        {
          headers: { Authorization: `Bearer ${config("WORKOS_API_KEY")}` },
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw new Error("Identity unavailable");
      return response.json();
    },
  });
  return {
    secret: config("SCOPE_PROBE_SECRET"),
    userId: identity.userId as Id<"users">,
    requester: identity.requester,
  };
}
function key() {
  const k = Buffer.from(config("SCOPE_PROBE_TOKEN_KEY"), "base64");
  if (k.length !== 32) throw new Error("Invalid key");
  return k;
}
export function seal(token: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  return Buffer.concat([
    iv,
    cipher.update(token, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
export function unseal(value: string) {
  const b = Buffer.from(value, "base64"),
    dec = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  dec.setAuthTag(b.subarray(-16));
  return Buffer.concat([dec.update(b.subarray(12, -16)), dec.final()]).toString(
    "utf8",
  );
}
export function fingerprint(value: string) {
  return createHmac("sha256", key()).update(value).digest("hex");
}
export async function airtableGrant(account: Doc<"probeAccounts">) {
  const token = await getTokenResponse(
    account.connectorId,
    {
      subject: { type: "user", id: account.subjectId, issuer: account.issuer },
      installationId: account.installationId,
    },
    { forceRefresh: true },
  );
  if (
    token.connector.id !== account.connectorId ||
    !token.installationId ||
    token.installationId === "*" ||
    (account.installationId &&
      token.installationId !== account.installationId) ||
    !Number.isFinite(token.expiresAt) ||
    token.expiresAt <= Date.now() + 30_000
  )
    throw new Error("Invalid grant");
  const response = await fetch("https://api.airtable.com/v0/meta/whoami", {
    headers: { Authorization: `Bearer ${token.token}` },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Airtable API credential unavailable");
  const identity = await response.json();
  if (
    typeof identity.id !== "string" ||
    (account.providerUserId && identity.id !== account.providerUserId)
  )
    throw new Error("Account mismatch");
  return {
    token: token.token,
    expiresAt: token.expiresAt,
    providerUserId: identity.id as string,
    installationId: token.installationId,
  };
}
export async function retrieve(
  actor: Awaited<ReturnType<typeof requester>>,
  id: Id<"probeRequests">,
) {
  const client = db();
  let claim = await client.mutation(api.probe.claim, { ...actor, id });
  if (claim.status === "acquire" && claim.account && claim.lease) {
    const grant = await airtableGrant(claim.account);
    await client.mutation(api.probe.finalize, {
      ...actor,
      id,
      lease: claim.lease,
      cipher: seal(grant.token),
      fingerprint: fingerprint(grant.token),
      expiresAt: grant.expiresAt,
    });
    claim = await client.mutation(api.probe.claim, { ...actor, id });
  }
  return claim;
}
