import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { acquireVerifiedCredential, disconnect } from "@/lib/providers";
import { config, ownerDb, scopeOrigin } from "@/lib/scope-server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const redirect = new URL("/connections", scopeOrigin()),
    url = new URL(request.url),
    id = url.searchParams.get("attempt");
  try {
    if (
      !id ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
      url.searchParams.has("error")
    )
      throw new Error("Connection unavailable");
    const jar = await cookies(),
      proof = jar.get("scope-connect-" + id)?.value;
    if (!proof) throw new Error("Connection unavailable");
    const client = await ownerDb(),
      secret = config("SCOPE_SERVICE_SECRET"),
      proofHash = createHash("sha256").update(proof).digest("hex");
    const attempt = await client.query(api.accounts.connectionAttempt, {
      secret,
      id: id as Id<"connectionAttempts">,
      proofHash,
    });
    if (attempt.expiresAt <= Date.now()) throw new Error("Connection expired");
    let superseded = attempt.superseded;
    if (!attempt.accountId) {
      const grant = await acquireVerifiedCredential(
        {
          ...attempt.connect,
          integrationId: attempt.integrationId,
          profileId: attempt.profileId,
          profileVersion: attempt.profileVersion,
        },
        true,
      );
      const completed = await client.mutation(api.accounts.completeConnection, {
        secret,
        id: attempt.id,
        proofHash,
        providerUserId: grant.providerUserId,
        providerTenantId: grant.providerTenantId,
        label: grant.label,
        providerEmail: grant.providerEmail,
        installationId: grant.installationId,
        grantedScopes: grant.grantedScopes,
      });
      superseded = completed.superseded;
    }
    if (superseded) {
      const cleanup = await disconnect({
        ...superseded.connect,
        integrationId: superseded.integrationId,
        profileId: superseded.profileId,
        profileVersion: superseded.profileVersion,
      });
      if (cleanup.outcome === "succeeded")
        await client.mutation(api.accounts.acknowledgeSupersededCleanup, {
          secret,
          id: attempt.id,
          proofHash,
          subjectId: superseded.connect.subjectId,
          outcome: "succeeded",
        });
    }
    redirect.searchParams.set("connection", "connected");
  } catch {
    redirect.searchParams.set("connection", "failed");
  }
  return new Response(null, {
    status: 303,
    headers: { Location: redirect.toString(), "Cache-Control": "no-store" },
  });
}
