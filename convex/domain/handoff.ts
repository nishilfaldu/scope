// Decision, historical completion, and current authority are independent.
// Deadlines are events, even when their cleanup job has not run yet.
export type ResourceStatus = "staged" | "active" | "revoked" | "expired";
type TerminalEvent = { at: number; reason: string };

function firstEvent(events: TerminalEvent[], now: number) {
  // At equal timestamps a deadline wins: completion at its deadline is too late.
  return events
    .filter((event) => event.at <= now)
    .sort((a, b) => a.at - b.at)[0];
}

export function isRevocation(reason: string) {
  return reason === "revoked" || reason.endsWith("_revoked");
}

type ConnectionInvite = {
  status: "pending" | "approved" | "claimed" | "denied" | "expired";
  approvalDeadlineAt: number;
  pickupDeadlineAt?: number;
  ackDeadlineAt?: number;
  activationDeadlineAt?: number;
  claimAcknowledgedAt?: number;
  activatedAt?: number;
  replacesAgentConnectionId?: unknown;
  terminalReason?: string;
};

type ConnectionResource = {
  status: "staged" | "active" | "revoked";
  revocationReason?: string;
  revokedAt?: number;
};

export function connectionDeadline(invite: ConnectionInvite) {
  if (
    invite.claimAcknowledgedAt !== undefined ||
    invite.activatedAt !== undefined
  )
    return undefined;
  if (invite.status === "pending")
    return { at: invite.approvalDeadlineAt, reason: "approval_timeout" };
  if (invite.status === "approved" && invite.pickupDeadlineAt !== undefined)
    return { at: invite.pickupDeadlineAt, reason: "pickup_timeout" };
  if (invite.status === "claimed") {
    const at = invite.replacesAgentConnectionId
      ? invite.activationDeadlineAt
      : invite.ackDeadlineAt;
    if (at !== undefined)
      return {
        at,
        reason: invite.replacesAgentConnectionId
          ? "activation_timeout"
          : "claim_ack_timeout",
      };
  }
}

export function connectionHandoff(
  invite: ConnectionInvite,
  connection: ConnectionResource | null,
  lineageRevokedAt: number | undefined,
  now: number,
  predecessor: ConnectionResource | null = null,
) {
  if (invite.status === "denied")
    return {
      handoffStatus: "denied",
      resourceStatus: undefined,
      reason: undefined,
      terminalAt: undefined,
    };
  const predecessorLost =
    !!invite.replacesAgentConnectionId &&
    invite.activatedAt === undefined &&
    predecessor?.status !== "active";
  const deadline = connectionDeadline(invite);
  const events: TerminalEvent[] = deadline ? [deadline] : [];
  if (connection?.status === "revoked")
    events.push({
      at: connection.revokedAt ?? now,
      reason: connection.revocationReason ?? "revoked",
    });
  if (lineageRevokedAt !== undefined)
    events.push({ at: lineageRevokedAt, reason: "operator_revoked" });
  if (predecessorLost)
    events.push({
      at: predecessor?.revokedAt ?? now,
      reason: "predecessor_revoked",
    });
  const terminal = firstEvent(events, now);
  const reason = invite.terminalReason ?? terminal?.reason;
  const resourceStatus = connection
    ? lineageRevokedAt !== undefined ||
      predecessorLost ||
      (connection.status === "staged" && !!reason)
      ? ("revoked" as const)
      : connection.status
    : undefined;
  const handoffStatus = reason
    ? isRevocation(reason)
      ? "revoked"
      : reason
    : invite.claimAcknowledgedAt !== undefined ||
        invite.activatedAt !== undefined
      ? "ready"
      : invite.status === "pending"
        ? "waiting_for_approval"
        : invite.status === "approved"
          ? "waiting_for_pickup"
          : invite.status === "claimed"
            ? invite.replacesAgentConnectionId
              ? "waiting_for_activation"
              : "waiting_for_ack"
            : "expired";
  return { handoffStatus, resourceStatus, reason, terminalAt: terminal?.at };
}

type SliceRequest = {
  status: "pending" | "approved" | "claimed" | "denied";
  approvalDeadlineAt: number;
  pickupDeadlineAt?: number;
  ackDeadlineAt?: number;
  claimAcknowledgedAt?: number;
  terminalReason?: string;
};

type SliceResource = {
  status: "staged" | "active" | "revoked";
  expiresAt: number;
  revocationReason?: string;
  revokedAt?: number;
};

export function sliceDeadline(request: SliceRequest) {
  if (request.claimAcknowledgedAt !== undefined) return undefined;
  if (request.status === "pending")
    return { at: request.approvalDeadlineAt, reason: "approval_timeout" };
  if (request.status === "approved" && request.pickupDeadlineAt !== undefined)
    return { at: request.pickupDeadlineAt, reason: "pickup_timeout" };
  if (request.status === "claimed" && request.ackDeadlineAt !== undefined)
    return { at: request.ackDeadlineAt, reason: "claim_ack_timeout" };
}

export function sliceHandoff(
  request: SliceRequest,
  slice: SliceResource | null,
  parentActive: boolean,
  now: number,
  parentRevokedAt?: number,
) {
  if (request.status === "denied" && !request.terminalReason)
    return {
      handoffStatus: "denied",
      resourceStatus: undefined,
      reasonCode: undefined,
      terminalAt: undefined,
    };
  const deadline = sliceDeadline(request);
  const events: TerminalEvent[] = deadline ? [deadline] : [];
  if (slice) {
    events.push({ at: slice.expiresAt, reason: "slice_expired" });
    if (slice.status === "revoked")
      events.push({
        at: slice.revokedAt ?? now,
        reason: slice.revocationReason ?? "revoked",
      });
  }
  if (!parentActive)
    events.push({
      at: parentRevokedAt ?? now,
      reason: "agent_connection_revoked",
    });
  const terminal = firstEvent(events, now);
  const reasonCode = request.terminalReason ?? terminal?.reason;
  const resourceStatus: ResourceStatus | undefined = slice
    ? !parentActive || slice.status === "revoked"
      ? "revoked"
      : slice.status === "staged" &&
          reasonCode &&
          reasonCode !== "slice_expired"
        ? "revoked"
        : slice.expiresAt <= now
          ? "expired"
          : slice.status
    : undefined;
  const handoffStatus = reasonCode
    ? isRevocation(reasonCode)
      ? "revoked"
      : reasonCode
    : request.claimAcknowledgedAt !== undefined
      ? "ready"
      : request.status === "pending"
        ? "waiting_for_approval"
        : request.status === "approved"
          ? "waiting_for_pickup"
          : "waiting_for_ack";
  return {
    handoffStatus,
    resourceStatus,
    reasonCode,
    terminalAt: terminal?.at,
  };
}
