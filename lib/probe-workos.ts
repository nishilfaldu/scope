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
  // Standalone Connect preserves the user.id supplied by our authenticated
  // completion endpoint in sub; it does not create a User Management record.
  // Resolve this only after signature, issuer, audience and consent validation.
  let externalId: unknown = payload.sub;
  if (!payload.sub.startsWith("scope:")) {
    const user = await options.getUser(payload.sub);
    if (user.id !== payload.sub) throw new Error("Unlinked identity");
    externalId = user.external_id;
  }
  if (typeof externalId !== "string" || !/^scope:[^:\s]+$/.test(externalId))
    throw new Error("Unlinked identity");
  return {
    userId: externalId.slice(6),
    requester: `${payload.sub}:${payload.client_id}:${payload.sid}`,
  };
}
