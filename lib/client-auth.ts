import type { JWTVerifyGetKey } from "jose";
import { verifyAuthkitToken } from "@/shared/authkit.mjs";
export type ClientActor = {
  issuer: string;
  subject: string;
  clientId: string;
  sessionId: string;
};
export async function verifyClient(
  token: string,
  options: { webClientId: string; clientId: string; keys?: JWTVerifyGetKey },
): Promise<ClientActor> {
  const { issuer, subject, clientId, sessionId } = await verifyAuthkitToken(
    token,
    options,
  );
  return { issuer, subject, clientId, sessionId };
}
