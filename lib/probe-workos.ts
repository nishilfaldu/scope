import { jwtVerify, type JWTVerifyGetKey } from "jose";

export async function verifyRequester(
  token: string,
  options: {
    issuer: string;
    resource: string;
    keys: JWTVerifyGetKey;
    getUser: (id: string) => Promise<{ id?: unknown; external_id?: unknown }>;
  },
) {
  const { payload } = await jwtVerify(token, options.keys, {
    issuer: options.issuer,
    audience: options.resource,
    requiredClaims: ["sub", "exp", "client_id", "sid"],
  });
  if (
    typeof payload.sub !== "string" ||
    !payload.sub ||
    typeof payload.client_id !== "string" ||
    !payload.client_id ||
    typeof payload.sid !== "string" ||
    !payload.sid
  )
    throw new Error("Invalid user token");
  const user = await options.getUser(payload.sub);
  if (
    user.id !== payload.sub ||
    typeof user.external_id !== "string" ||
    !user.external_id.startsWith("scope:") ||
    !user.external_id.slice(6)
  )
    throw new Error("Unlinked identity");
  return {
    userId: user.external_id.slice(6),
    requester: `${payload.sub}:${payload.client_id}:${payload.sid}`,
  };
}
