import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ClientActor } from "./client-auth";
import { acquireVerifiedCredential } from "./providers";
import { db, scopeOrigin } from "./scope-server";
export type ServiceActor = ClientActor & { secret: string };
export async function listAccounts(
  actor: ServiceActor,
  cursor: string | null = null,
) {
  return db().query(api.accounts.listForClient, {
    ...actor,
    paginationOpts: { cursor, numItems: 50 },
  });
}
export async function requestAccess(
  actor: ServiceActor,
  args: {
    accountId: Id<"connectedAccounts">;
    agentName: string;
    reason: string;
  },
) {
  const result = await db().mutation(api.access.request, { ...actor, ...args });
  return {
    ...result,
    approvalUrl: scopeOrigin() + "/access?request=" + result.id,
  };
}
export async function requestStatus(
  actor: ServiceActor,
  id: Id<"accessApprovals">,
) {
  return db().query(api.access.status, { ...actor, id });
}
export async function deliverCredential(
  actor: ServiceActor,
  id: Id<"accessApprovals">,
) {
  const preflight = await db().query(api.access.preflight, {
    ...actor,
    id,
    now: Date.now(),
  });
  if (
    preflight.status !== "acquire" ||
    !preflight.account ||
    preflight.grantVersion === undefined ||
    preflight.accountId === undefined ||
    preflight.providerId === undefined
  )
    return { status: preflight.status };
  const credential = await acquireVerifiedCredential(preflight.account);
  const authorized = await db().mutation(api.access.authorizeCollection, {
    ...actor,
    id,
    grantVersion: preflight.grantVersion,
    grantedScopes: credential.grantedScopes,
  });
  return {
    status: "ready" as const,
    requestId: id,
    accountId: preflight.accountId,
    providerId: preflight.providerId,
    grantVersion: preflight.grantVersion,
    grantedScopes: credential.grantedScopes,
    accessToken: credential.accessToken,
    until: authorized.until,
    receiptProof: authorized.receiptProof,
  };
}
export async function recordReceipt(
  actor: ServiceActor,
  id: Id<"accessApprovals">,
  receiptProof: string,
) {
  return db().mutation(api.access.acknowledge, { ...actor, id, receiptProof });
}
