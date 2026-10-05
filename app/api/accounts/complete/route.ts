import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { inspectConnection, ProviderFailure } from "@/lib/connect";
import { config, ownerDb, scopeOrigin } from "@/lib/scope-server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const redirect = new URL("/connections", scopeOrigin()),
    url = new URL(request.url),
    reference = url.searchParams.get("setup");
  let client: Awaited<ReturnType<typeof ownerDb>> | undefined,
    verified = false;
  try {
    if (!reference || !/^[A-Za-z0-9_-]{1,128}$/.test(reference))
      throw new Error("Invalid connection");
    const proof = (await cookies()).get("scope-connect-" + reference)?.value;
    if (!proof) throw new Error("Connection unavailable");
    client = await ownerDb();
    const secret = config("SCOPE_SERVICE_SECRET"),
      id = reference as Id<"connectedAccounts">,
      proofHash = createHash("sha256").update(proof).digest("hex");
    const row = await client.query(api.accounts.setupForOwner, {
      secret,
      id,
      proofHash,
    });
    verified = true;
    if (url.searchParams.has("error"))
      throw new Error("Sign-in did not complete");
    if (row.state !== "active") {
      const grant = await inspectConnection({
        ...row.connect,
        providerId: row.providerId,
        providerName: row.providerName,
        scopes: row.requestedScopes,
      });
      const result = await client.mutation(api.accounts.completeConnection, {
        secret,
        id,
        proofHash,
        activate: true,
        providerUserId: grant.providerUserId,
        providerTenantId: grant.providerTenantId,
        label: grant.label,
        installationId: grant.installationId,
        grantedScopes: grant.grantedScopes,
      });
      if (!result.active) throw new ProviderFailure("grant-rejected");
    }
    redirect.searchParams.set("connection", "connected");
  } catch (error) {
    const issue =
      error instanceof ProviderFailure ? error.kind : "authority-invalid";
    if (verified && client && reference)
      await client
        .mutation(api.accounts.setupFailed, {
          secret: config("SCOPE_SERVICE_SECRET"),
          id: reference as Id<"connectedAccounts">,
          issue,
        })
        .catch(() => {});
    redirect.searchParams.set("connection", "failed");
    redirect.searchParams.set("error", issue);
  }
  return new Response(null, {
    status: 303,
    headers: { Location: redirect.toString(), "Cache-Control": "no-store" },
  });
}
