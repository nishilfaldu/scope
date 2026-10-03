import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ClientActor } from "./client-auth";
import {
  acquireVerifiedCredential,
  integrationFor,
  requireEnabledIntegration,
} from "./providers";
import { db, scopeOrigin } from "./scope-server";

export type ServiceActor = ClientActor & { secret: string };
export async function ensureConnection(actor: ServiceActor) {
  return db().mutation(api.clientConnections.ensure, actor);
}
export async function listAccounts(actor: ServiceActor) {
  await ensureConnection(actor);
  const rows = await db().query(api.approvals.listAccounts, actor);
  return rows.filter((row) => {
    const integration = integrationFor(row.integrationId);
    return (
      integration.enabled &&
      row.profileId === integration.profileId &&
      row.profileVersion === integration.profileVersion
    );
  });
}
export async function listCollectors(actor: ServiceActor) {
  await ensureConnection(actor);
  return db().query(api.clientConnections.collectors, actor);
}
export async function requestAccess(
  actor: ServiceActor,
  args: {
    key: string;
    accountId: Id<"connectedAccounts">;
    reason: string;
    intent?: string;
    collectorConnectionId?: Id<"clientConnections">;
  },
) {
  const account = (await listAccounts(actor)).find(
    (row) => row.id === args.accountId,
  );
  if (!account) throw new Error("Account unavailable");
  requireEnabledIntegration(account.integrationId);
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
  await ensureConnection(actor);
  const result = await db().query(api.approvals.status, { ...actor, id });
  const status =
    !result.accountAvailable ||
    result.requesterStopped ||
    result.collectorStopped
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
  await ensureConnection(actor);
  const preflight = await db().query(api.approvals.preflight, {
    ...actor,
    id,
    now: Date.now(),
  });
  if (preflight.status !== "acquire") return { status: preflight.status };
  requireEnabledIntegration(preflight.integrationId);
  const credential = await acquireVerifiedCredential(preflight.account);
  // Provider IO may outlive a cancellation, stop, disconnect or reconnect.
  // This transaction, after verification, is the only release authorization point.
  const authorized = await db().mutation(api.approvals.authorizeDelivery, {
    ...actor,
    id,
    grantVersion: preflight.grantVersion,
    profileId: preflight.profileId,
    profileVersion: preflight.profileVersion,
    providerExpiresAt: credential.providerExpiresAt,
    ...(credential.tokenId ? { tokenId: credential.tokenId } : {}),
  });
  return {
    status: "ready" as const,
    requestId: id,
    accountId: preflight.accountId,
    integrationId: preflight.integrationId,
    grantVersion: preflight.grantVersion,
    profileId: preflight.profileId,
    profileVersion: preflight.profileVersion,
    requesterConnectionId: preflight.requesterConnectionId,
    collectorConnectionId: preflight.collectorConnectionId,
    intent: preflight.intent,
    accessToken: credential.accessToken,
    providerExpiresAt: credential.providerExpiresAt,
    providerUserId: credential.providerUserId,
    providerTenantId: credential.providerTenantId,
    approvalExpiresAt: authorized.approvalExpiresAt,
    receiptProof: authorized.receiptProof,
  };
}
export async function recordReceipt(
  actor: ServiceActor,
  id: Id<"approvalRequests">,
  receiptProof: string,
) {
  // Historical receipt is permitted after a local stop. Do not re-enable or
  // re-register the connection just to acknowledge a past response.
  return db().mutation(api.approvals.acknowledge, {
    ...actor,
    id,
    receiptProof,
  });
}
export async function waitForDecision(
  actor: ServiceActor,
  id: Id<"approvalRequests">,
  seconds: number,
  signal: AbortSignal,
) {
  const until = Date.now() + seconds * 1000;
  let result = await requestStatus(actor, id);
  while (result.status === "pending" && Date.now() < until && !signal.aborted) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(
        done,
        Math.min(1000, Math.max(0, until - Date.now())),
      );
      signal.addEventListener("abort", done, { once: true });
    });
    if (!signal.aborted) result = await requestStatus(actor, id);
  }
  return {
    requestId: id,
    status: result.status,
    approvalExpiresAt: result.approvalExpiresAt,
  };
}
