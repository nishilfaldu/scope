import { startAuthorization, revokeToken } from "@vercel/connect";
import { notifyApproval } from "@/lib/probe-push";
import { patBindings, patBindingForKey } from "@/lib/probe-pat-bindings";
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
    if (
      operation === "request" ||
      operation === "deliver" ||
      operation === "ack"
    ) {
      const actor = await requester(request);
      if (operation === "ack") {
        await db().mutation(api.probe.acknowledge, {
          ...actor,
          id: body.id,
          receiptId: body.receiptId,
        });
        return json({ received: true });
      }
      if (operation === "deliver") {
        const c = await retrieve(actor, body.id);
        return c.status === "ready" && c.cipher && c.account
          ? json({
              status: "ready",
              accessToken: unseal(c.cipher),
              expiresAt: c.expiresAt,
              accountId: c.account._id,
              providerUserId: c.account.providerUserId,
              credentialKind: c.account.credentialKind ?? "oauth",
              baseId: c.account.baseId,
              providerExpiresAt:
                c.account.credentialKind === "shared-pat" ? null : c.expiresAt,
              approvalExpiresAt: c.approvalExpiresAt,
              receiptId: c.receiptId,
            })
          : json({ status: c.status });
      }
      const result = await db().mutation(api.probe.request, {
        ...actor,
        key: body.key,
        accountId: body.accountId,
        reason: body.reason,
      });
      return json({
        ...result,
        approvalUrl:
          config("SCOPE_PROBE_ORIGIN") + "/approvals?request=" + result.id,
      });
    }
    sameOrigin(request);
    const client = await ownerDb();
    if (operation === "pat" || operation === "pat-bindings") {
      const identity = await client.query(api.probe.identity, {});
      if (identity?.id !== config("SCOPE_PAT_TEST_OWNER_ID"))
        throw new Error("Test owner required");
      if (operation === "pat-bindings")
        return json({
          bindings: patBindings.map(({ key, label }) => ({ key, label })),
        });
      const binding = patBindingForKey(body.bindingKey);
      const accounts = await client.query(api.probe.accountsForOwner, {});
      const existing = accounts.find(
        (account: {
          credentialKind?: string;
          connectorId: string;
          baseId?: string;
          revoked: boolean;
        }) =>
          account.credentialKind === "shared-pat" &&
          !account.revoked &&
          account.connectorId === binding.connectorId &&
          account.baseId === binding.baseId,
      );
      const id =
        existing?._id ??
        (await client.mutation(api.probe.addAccount, {
          secret: config("SCOPE_PROBE_SECRET"),
          label: binding.label,
          connectorId: binding.connectorId,
          issuer: config("NEXT_PUBLIC_CONVEX_SITE_URL"),
          credentialKind: "shared-pat",
          baseId: binding.baseId,
        }));
      const account = await client.query(api.probe.account, { id });
      const grant = await airtableGrant(account);
      await client.mutation(api.probe.confirmAccount, {
        secret: config("SCOPE_PROBE_SECRET"),
        id,
        providerUserId: grant.providerUserId,
        installationId: grant.installationId,
      });
      return json({
        id,
        providerUserId: grant.providerUserId,
        providerExpiresAt: null,
      });
    }
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
        secret: config("SCOPE_PROBE_SECRET"),
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
          callbackUrl:
            config("SCOPE_PROBE_ORIGIN") + "/connections?account=" + id,
          expiresInMs: 600_000,
        },
      );
      return json({ id, url: auth.url });
    }
    if (operation === "confirm") {
      const account = await client.query(api.probe.account, { id: body.id });
      const grant = await airtableGrant(account);
      await client.mutation(api.probe.confirmAccount, {
        secret: config("SCOPE_PROBE_SECRET"),
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
      if (account.credentialKind === "shared-pat")
        return json({
          localRevoked: true,
          connectRevoked: false,
          sharedPat: true,
        });
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
