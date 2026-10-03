import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { airtableGrant, config, ownerDb } from "@/lib/probe-server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const origin = config("SCOPE_PROBE_ORIGIN");
  const id = new URL(request.url).searchParams.get("attempt");
  let connected = false;
  try {
    if (new URL(request.url).searchParams.has("error"))
      throw new Error("Cancelled sign-in");
    if (!id || !/^[a-z0-9]+$/.test(id)) throw new Error("Invalid attempt");
    const proof = (await cookies()).get("scope-connect-" + id)?.value;
    if (!proof) throw new Error("Missing browser proof");
    const proofHash = createHash("sha256").update(proof).digest("hex");
    const client = await ownerDb();
    const attempt = await client.query(api.probe.connectionAttempt, {
      id: id as Id<"probeConnectionAttempts">,
    });
    if (attempt.proofHash !== proofHash || attempt.expiresAt <= Date.now())
      throw new Error("Expired attempt");
    if (attempt.accountId) {
      const account = await client.query(api.probe.account, {
        id: attempt.accountId,
      });
      connected = !account.revoked;
    } else {
      const grant = await airtableGrant({ ...attempt, revoked: false });
      if (!grant.installationId) throw new Error("Missing installation");
      await client.mutation(api.probe.completeConnection, {
        secret: config("SCOPE_PROBE_SECRET"),
        id: attempt._id,
        proofHash,
        providerUserId: grant.providerUserId,
        providerEmail: grant.providerEmail,
        installationId: grant.installationId,
      });
      connected = true;
    }
  } catch {
    /* Failed/cancelled sign-in never creates an account. */
  }
  const response = NextResponse.redirect(
    new URL(
      "/connections?airtable=" + (connected ? "connected" : "failed"),
      origin,
    ),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  if (!connected && id && /^[a-z0-9]+$/.test(id))
    response.cookies.set("scope-connect-" + id, "", {
      maxAge: 0,
      path: "/api/probe/complete",
    });
  return response;
}
