import { ALL_APPS, type AppId } from "../convex/domain/apps";

export { ALL_APPS, type AppId };

export const APP_LABELS: Record<AppId, string> = { slack: "Slack" };
export const APP_PERMISSIONS: Record<AppId, string> = {
  slack:
    "Read conversations and files, send messages, and manage pins and reactions with the connected Slack user.",
};

export const STATUS_LABELS = {
  staged: "Setup incomplete",
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
} as const;

export function handoffLabel(status: string): string {
  switch (status) {
    case "waiting_for_approval":
      return "Waiting for your approval";
    case "waiting_for_pickup":
      return "Approved—waiting for agent pickup";
    case "waiting_for_ack":
      return "Waiting for agent acknowledgment";
    case "waiting_for_activation":
      return "Waiting for replacement activation";
    case "ready":
      return "Ready";
    case "approval_timeout":
      return "Approval timed out";
    case "pickup_timeout":
      return "Agent did not pick up credentials in time";
    case "claim_ack_timeout":
      return "Agent did not acknowledge credentials in time";
    case "activation_timeout":
      return "Replacement was not activated in time";
    case "denied":
      return "Denied";
    case "revoked":
    case "operator_revoked":
      return "Revoked";
    case "expired":
    case "slice_expired":
      return "Grant expired";
    case "agent_cancelled":
      return "Cancelled by agent";
    default:
      return status.replaceAll("_", " ");
  }
}

export function effectiveSliceStatus(
  slice: {
    status: "staged" | "active" | "revoked" | "expired";
    expiresAt: number;
  },
  now: number,
) {
  return slice.status === "revoked"
    ? ("revoked" as const)
    : slice.expiresAt <= now
      ? ("expired" as const)
      : slice.status;
}

export function formatRemaining(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60_000);
  if (minutes === 0) return "<1m left";
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 48) return `${hours}h ${remainingMinutes}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ${remainingMinutes}m left`;
}
