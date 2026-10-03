import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Id } from "@/convex/_generated/dataModel";

export type ClientActor = {
  userId: Id<"users">;
  issuer: string;
  subject: string;
  clientId: string;
  consentId: string;
};
const keySets = new Map<string, JWTVerifyGetKey>();
export async function verifyClient(
  token: string,
  {
    issuer,
    resource,
    keys,
  }: { issuer: string; resource: string; keys?: JWTVerifyGetKey },
): Promise<ClientActor> {
  if (!keys) {
    keys = keySets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL("/oauth2/jwks", issuer));
      keySets.set(issuer, keys);
    }
  }
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ["RS256"],
    issuer,
    audience: resource,
    requiredClaims: ["sub", "exp", "client_id", "sid"],
  });
  if (
    typeof payload.sub !== "string" ||
    !/^scope:[^:\s]+$/.test(payload.sub) ||
    typeof payload.client_id !== "string" ||
    !payload.client_id.trim() ||
    typeof payload.sid !== "string" ||
    !payload.sid.trim()
  )
    throw new Error("Unauthorized client");
  return {
    userId: payload.sub.slice(6) as Id<"users">,
    issuer,
    subject: payload.sub,
    clientId: payload.client_id,
    consentId: payload.sid,
  };
}
