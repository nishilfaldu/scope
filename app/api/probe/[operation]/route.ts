import { startAuthorization, revokeToken } from "@vercel/connect";
import { notifyApproval } from "@/lib/probe-push";
import { api } from "@/convex/_generated/api";
import {
  config,
  db,
  ownerDb,
  sameOrigin,
  safeError,
  json,
  requester,
  retrieve,
  unseal,
  airtableGrant,
} from "@/lib/probe-server";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  try {
    const { operation } = await params;
    if (Number(request.headers.get("content-length") ?? 0) > 8192)
      return new Response(null, { status: 413 });
    const body = await request.json();
    if (operation === "request" || operation === "deliver") {
      const actor = await requester(request);
      if (operation === "deliver") {
        const c = await retrieve(actor, body.id);
        return c.status === "ready" && c.cipher && c.account
          ? json({
              status: "ready",
              accessToken: unseal(c.cipher),
              expiresAt: c.expiresAt,
              accountId: c.account._id,
              providerUserId: c.account.providerUserId,
            })
          : json({ status: c.status });
      }
      const result = await db().mutation(api.probe.request, {
        ...actor,
        key: body.key,
        accountId: body.accountId,
        reason: body.reason,
      });
      if (result.created) await notifyApproval(actor.userId);
      return json({
        ...result,
        approvalUrl: config("SCOPE_PROBE_ORIGIN") + "/lab",
      });
    }
    sameOrigin(request);
    const client = await ownerDb();
    if (operation === "push-test") {
      const identity = await client.query(api.probe.identity, {});
      if (!identity) throw new Error("Sign in required");
      return json(await notifyApproval(identity.id));
    }
    if (operation === "workos") {
      const identity = await client.query(api.probe.identity, {});
      if (
        !identity ||
        typeof body.external_auth_id !== "string" ||
        body.external_auth_id.length > 300
      )
        throw new Error("Invalid authentication");
      const response = await fetch(
        "https://api.workos.com/authkit/oauth2/complete",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config("WORKOS_API_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            external_auth_id: body.external_auth_id,
            user: { id: `scope:${identity.id}`, email: identity.email },
          }),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw new Error("WorkOS rejected completion");
      const data = await response.json();
      const url = new URL(data.redirect_uri);
      if (url.origin !== config("WORKOS_ISSUER"))
        throw new Error("Invalid redirect");
      return json({ url: url.toString() });
    }
    if (operation === "authorize") {
      const id = await client.mutation(api.probe.addAccount, {
        label: body.label,
        connectorId: config("CONNECT_AIRTABLE_CONNECTOR"),
        issuer: config("NEXT_PUBLIC_CONVEX_SITE_URL"),
      });
      const account = await client.query(api.probe.account, { id });
      const auth = await startAuthorization(
        account.connectorId,
        {
          subject: {
            type: "user",
            id: account.subjectId,
            issuer: account.issuer,
          },
        },
        {
          callbackUrl: config("SCOPE_PROBE_ORIGIN") + "/lab?account=" + id,
          expiresInMs: 600_000,
        },
      );
      return json({ id, url: auth.url });
    }
    if (operation === "confirm") {
      const account = await client.query(api.probe.account, { id: body.id });
      const grant = await airtableGrant(account);
      await client.mutation(api.probe.confirmAccount, {
        id: body.id,
        providerUserId: grant.providerUserId,
        installationId: grant.installationId,
      });
      return json({
        providerUserId: grant.providerUserId,
        expiresAt: grant.expiresAt,
      });
    }
    if (operation === "revoke") {
      const account = await client.query(api.probe.account, { id: body.id });
      await client.mutation(api.probe.revokeAccount, { id: body.id });
      try {
        await revokeToken(account.connectorId, {
          subject: {
            type: "user",
            id: account.subjectId,
            issuer: account.issuer,
          },
          installationId: account.installationId,
        });
        return json({ localRevoked: true, connectRevoked: true });
      } catch {
        return json({ localRevoked: true, connectRevoked: false });
      }
    }
    return new Response(null, { status: 404 });
  } catch {
    return safeError();
  }
}
