import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  beginAuthorization,
  configuredIntegration,
  disconnect,
  integrations,
  integrationFor,
} from "@/lib/providers";
import {
  config,
  ownerDb,
  sameOrigin,
  scopeOrigin,
  json,
  safeError,
} from "@/lib/scope-server";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  try {
    await ownerDb();
    if ((await params).operation !== "integrations")
      return new Response(null, { status: 404 });
    return json({
      integrations: integrations.map((item) => ({
        id: item.id,
        provider: item.provider,
        enabled: item.enabled,
        accessDescription: item.accessDescription,
        revocationNote: item.revocationNote,
      })),
    });
  } catch {
    return safeError(401);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  try {
    sameOrigin(request);
    const client = await ownerDb(),
      secret = config("SCOPE_SERVICE_SECRET"),
      { operation } = await params,
      raw = await request.text();
    if (Buffer.byteLength(raw) > 8192) return safeError(413);
    const body: unknown = JSON.parse(raw);
    if (operation === "authorize") {
      const args = z
        .object({
          integrationId: z.string(),
          targetAccountId: z.string().optional(),
        })
        .strict()
        .parse(body);
      const { integration, connectorId } = await configuredIntegration(
          args.integrationId,
        ),
        issuer = config("NEXT_PUBLIC_CONVEX_SITE_URL"),
        proof = randomBytes(32).toString("hex");
      const attempt = await client.mutation(api.accounts.beginConnection, {
        secret,
        integrationId: integration.id,
        connectorId,
        issuer,
        profileId: integration.profileId,
        profileVersion: integration.profileVersion,
        providerName: integration.provider,
        accessDescription: integration.accessDescription,
        proofHash: createHash("sha256").update(proof).digest("hex"),
        targetAccountId: args.targetAccountId as
          Id<"connectedAccounts"> | undefined,
      });
      const callback = new URL("/api/accounts/complete", scopeOrigin());
      callback.searchParams.set("attempt", attempt.id);
      const authorization = await beginAuthorization(
        {
          integrationId: integration.id,
          connectorId,
          subjectId: attempt.subjectId,
          issuer,
          profileId: integration.profileId,
          profileVersion: integration.profileVersion,
        },
        callback.toString(),
      );
      (await cookies()).set("scope-connect-" + attempt.id, proof, {
        httpOnly: true,
        sameSite: "lax",
        secure: scopeOrigin().startsWith("https:"),
        maxAge: 600,
        path: "/api/accounts/complete",
      });
      return json(authorization);
    }
    if (operation === "disconnect") {
      const { id } = z.object({ id: z.string() }).strict().parse(body),
        accountId = id as Id<"connectedAccounts">;
      const blocked = await client.mutation(api.accounts.block, {
          id: accountId,
        }),
        integration = integrationFor(blocked.integrationId);
      const result = await disconnect({
        ...blocked.connect,
        integrationId: integration.id,
        profileId: integration.profileId,
        profileVersion: integration.profileVersion,
      });
      await client.mutation(api.accounts.recordDisconnect, {
        secret,
        id: accountId,
        grantVersion: blocked.grantVersion,
        outcome: result.outcome,
      });
      return json({ sharingStopped: true, outcome: result.outcome });
    }
    return new Response(null, { status: 404 });
  } catch {
    return safeError();
  }
}
