import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  beginAuthorization,
  configuredSlack,
  disconnect,
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
    if ((await params).operation !== "provider")
      return new Response(null, { status: 404 });
    const { scopes } = await configuredSlack();
    return json({
      providerId: "slack",
      provider: "Slack",
      permissions: scopes,
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
          providerId: z.literal("slack"),
          targetAccountId: z.string().optional(),
        })
        .strict()
        .parse(body);
      const { connectorId, scopes: requestedScopes } = await configuredSlack(),
        issuer = config("NEXT_PUBLIC_CONVEX_SITE_URL"),
        proof = randomBytes(32).toString("hex");
      const attempt = await client.mutation(api.accounts.beginConnection, {
        secret,
        providerId: "slack",
        connectorId,
        issuer,
        requestedScopes,
        providerName: "Slack",
        accessDescription: requestedScopes.join(", "),
        proofHash: createHash("sha256").update(proof).digest("hex"),
        targetAccountId: args.targetAccountId as
          Id<"connectedAccounts"> | undefined,
      });
      const callback = new URL("/api/accounts/complete", scopeOrigin());
      callback.searchParams.set("attempt", attempt.id);
      const authorization = await beginAuthorization(
        {
          providerId: "slack",
          connectorId,
          subjectId: attempt.subjectId,
          issuer,
          grantedScopes: requestedScopes,
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
      const { id, grantVersion } = z
          .object({ id: z.string(), grantVersion: z.number().int().positive() })
          .strict()
          .parse(body),
        accountId = id as Id<"connectedAccounts">;
      const blocked = await client.mutation(api.accounts.block, {
        id: accountId,
        grantVersion,
      });
      if (blocked.disconnected) return json({ outcome: "succeeded" });
      const result = await disconnect({
        ...blocked.connect,
        providerId: blocked.providerId,
        grantedScopes: blocked.grantedScopes,
        providerUserId: blocked.providerUserId,
        providerTenantId: blocked.providerTenantId,
      });
      const outcome = await client.mutation(api.accounts.recordDisconnect, {
        secret,
        id: accountId,
        grantVersion: blocked.grantVersion,
        outcome: result.outcome,
      });
      return json({ outcome });
    }
    return new Response(null, { status: 404 });
  } catch {
    return safeError();
  }
}
