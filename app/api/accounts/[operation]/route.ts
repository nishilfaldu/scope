import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  beginAuthorization,
  configuredConnector,
  availableConnectors,
  disconnect,
  inspectConnection,
  ProviderFailure,
} from "@/lib/connect";
import {
  config,
  ownerDb,
  sameOrigin,
  scopeOrigin,
  json,
  safeError,
  safeFailure,
} from "@/lib/scope-server";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  try {
    await ownerDb();
  } catch {
    return safeError(401);
  }
  try {
    if ((await params).operation !== "providers")
      return new Response(null, { status: 404 });
    return json({ providers: await availableConnectors() });
  } catch (error) {
    return safeFailure(error);
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
      const { providerId } = z
        .object({ providerId: z.string().min(1).max(64) })
        .strict()
        .parse(body);
      const {
          connectorId,
          scopes: requestedScopes,
          provider,
        } = await configuredConnector(providerId),
        issuer = config("NEXT_PUBLIC_CONVEX_SITE_URL"),
        proof = randomBytes(32).toString("hex");
      const attempt = await client.mutation(api.accounts.beginConnection, {
        secret,
        providerId,
        connectorId,
        issuer,
        requestedScopes,
        providerName: provider,
        proofHash: createHash("sha256").update(proof).digest("hex"),
      });
      const callback = new URL("/api/accounts/complete", scopeOrigin());
      callback.searchParams.set("setup", attempt.id);
      const authorization = await beginAuthorization(
        {
          connectorId,
          subjectId: attempt.subjectId,
          issuer,
          scopes: requestedScopes,
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
      let saved = await client.query(api.accounts.setupForOwner, {
        secret,
        id: accountId,
      });
      if (saved.grantVersion !== grantVersion)
        throw new Error("Account changed");
      if (saved.provisional && !saved.authorizationKey) {
        try {
          const grant = await inspectConnection({
            ...saved.connect,
            providerId: saved.providerId,
            providerName: saved.providerName,
            scopes: saved.requestedScopes,
          });
          await client.mutation(api.accounts.completeConnection, {
            secret,
            id: accountId,
            activate: false,
            providerUserId: grant.providerUserId,
            providerTenantId: grant.providerTenantId,
            label: grant.label,
            installationId: grant.installationId,
            grantedScopes: grant.grantedScopes,
          });
          saved = await client.query(api.accounts.setupForOwner, {
            secret,
            id: accountId,
          });
        } catch (error) {
          if (error instanceof ProviderFailure && error.authorizationAbsent) {
            await client.mutation(api.accounts.abandonWithoutGrant, {
              secret,
              id: accountId,
            });
            return json({ outcome: "succeeded" });
          }
          throw error;
        }
      }
      const blocked = await client.mutation(api.accounts.block, {
        secret,
        id: accountId,
        grantVersion,
      });
      if (blocked.disconnectOutcome === "succeeded")
        return json({ outcome: "succeeded" });
      const result = await disconnect({
        ...blocked.connect,
      });
      const outcome = await client.mutation(api.accounts.recordDisconnect, {
        secret,
        id: accountId,
        grantVersion: blocked.grantVersion,
        outcome: result.outcome,
      });
      return json({
        outcome,
        ...(result.outcome === "failed" ? { code: result.code } : {}),
      });
    }
    return new Response(null, { status: 404 });
  } catch (error) {
    return safeFailure(error);
  }
}
