import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ClientActor } from "./client-auth";
import { acquireVerifiedCredential } from "./providers";
import { db, scopeOrigin } from "./scope-server";
export type ServiceActor = ClientActor & { secret: string };
export type CommandContext = {
  argv: string[];
  cwd: string;
  envVar: string;
};
export async function ensureConnection(actor: ServiceActor) {
  return db().mutation(api.clientConnections.ensure, actor);
}
export async function listAccounts(actor: ServiceActor) {
  await ensureConnection(actor);
  return db().query(api.approvals.listAccounts, actor);
}
export async function requestAccess(
  actor: ServiceActor,
  args: {
    key: string;
    accountId: Id<"connectedAccounts">;
    reason: string;
    command: CommandContext;
  },
) {
  await ensureConnection(actor);
  const result = await db().mutation(api.approvals.request, {
    ...actor,
    ...args,
  });
  return {
    ...result,
    approvalUrl: scopeOrigin() + "/approvals?request=" + result.id,
  };
}
export async function requestStatus(
  actor: ServiceActor,
  id: Id<"approvalRequests">,
) {
  const result = await db().query(api.approvals.status, { ...actor, id });
  const status =
    !result.accountAvailable || result.requesterStopped
      ? "unavailable"
      : result.status === "denied" || result.status === "cancelled"
        ? result.status
        : result.approvalExpiresAt <= Date.now()
          ? "expired"
          : result.status;
  return { ...result, status };
}
export async function deliverCredential(
  actor: ServiceActor,
  id: Id<"approvalRequests">,
) {
  const preflight = await db().query(api.approvals.preflight, {
    ...actor,
    id,
    now: Date.now(),
  });
  if (preflight.status !== "acquire") return { status: preflight.status };
  const credential = await acquireVerifiedCredential(preflight.account);
  // Recheck authority after provider IO before any credential leaves the server.
  const authorized = await db().mutation(api.approvals.authorizeDelivery, {
    ...actor,
    id,
    grantVersion: preflight.grantVersion,
    grantedScopes: credential.grantedScopes,
    ...(credential.tokenId ? { tokenId: credential.tokenId } : {}),
  });
  return {
    status: "ready" as const,
    requestId: id,
    accountId: preflight.accountId,
    providerId: preflight.providerId,
    grantVersion: preflight.grantVersion,
    requesterConnectionId: preflight.requesterConnectionId,
    command: preflight.command,
    grantedScopes: credential.grantedScopes,
    accessToken: credential.accessToken,
    approvalExpiresAt: authorized.approvalExpiresAt,
    receiptProof: authorized.receiptProof,
  };
}
export async function recordReceipt(
  actor: ServiceActor,
  id: Id<"approvalRequests">,
  receiptProof: string,
) {
  return db().mutation(api.approvals.acknowledge, {
    ...actor,
    id,
    receiptProof,
  });
}
export async function cancelRequest(
  actor: ServiceActor,
  id: Id<"approvalRequests">,
) {
  return db().mutation(api.approvals.cancelForClient, { ...actor, id });
}
