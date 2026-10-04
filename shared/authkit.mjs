import { createRemoteJWKSet, jwtVerify } from "jose";
const keySets = new Map();
/** @param {string} webClientId */
export function authkitIssuer(webClientId) {
  if (!/^client_[A-Za-z0-9]+$/.test(webClientId))
    throw new Error("Invalid AuthKit application");
  return `https://api.workos.com/user_management/${webClientId}`;
}
/**
 * AuthKit's modern tokens share the environment/default application's issuer.
 * The authenticating application is the signed client_id, not a Scope resource audience.
 * @param {string} token
 * @param {{webClientId: string, clientId: string, keys?: import("jose").JWTVerifyGetKey}} options
 */
export async function verifyAuthkitToken(
  token,
  { webClientId, clientId, keys },
) {
  const issuer = authkitIssuer(webClientId);
  if (!keys) {
    keys = keySets.get(webClientId);
    if (!keys) {
      keys = createRemoteJWKSet(
        new URL(`https://api.workos.com/sso/jwks/${webClientId}`),
      );
      keySets.set(webClientId, keys);
    }
  }
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ["RS256"],
    issuer,
    requiredClaims: ["sub", "exp", "client_id", "sid"],
  });
  if (
    typeof payload.sub !== "string" ||
    !/^user_[A-Za-z0-9]+$/.test(payload.sub) ||
    payload.client_id !== clientId ||
    typeof payload.sid !== "string" ||
    !/^session_[A-Za-z0-9]+$/.test(payload.sid)
  )
    throw new Error("Unauthorized AuthKit session");
  return {
    issuer,
    subject: payload.sub,
    clientId,
    sessionId: payload.sid,
    expiresAt: payload.exp * 1000,
  };
}
