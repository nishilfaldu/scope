import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
export type ApprovalAccount = FunctionReturnType<
  typeof api.accounts.forOwner
>[number];
export type ApprovalRequest = FunctionReturnType<
  typeof api.approvals.forOwner
>["page"][number];
export type TimelineEvent = {
  label: string;
  at?: number;
  detail?: string;
  tone: "done" | "waiting" | "stopped";
};

export function accountName(label?: string) {
  return label?.trim() || "Unavailable account";
}
export function deliveryDeadline(r: ApprovalRequest) {
  return r.approvalExpiresAt;
}
export function approvalStatus(
  r: ApprovalRequest,
  now: number,
  blocked = false,
) {
  if (r.status === "denied") return "Denied";
  if (r.status === "cancelled") return "Delivery stopped";
  if (blocked || !r.accountAvailable || r.requesterStopped)
    return "Sharing blocked";
  if (r.receivedAt) return "Received";
  if (deliveryDeadline(r) <= now)
    return r.status === "pending"
      ? "Expired"
      : r.deliveredAt
        ? "Receipt unconfirmed"
        : "Not collected";
  if (r.status === "approved")
    return r.deliveredAt ? "Waiting for receipt" : "Waiting for pickup";
  return "Needs approval";
}
export function requestOutcome(
  r: ApprovalRequest,
  now: number,
  blocked = false,
) {
  const status = approvalStatus(r, now, blocked);
  if (["Delivery stopped", "Sharing blocked"].includes(status))
    return r.receivedAt
      ? "Received earlier; further delivery is blocked."
      : r.deliveredAt
        ? "Receipt was never confirmed."
        : "No delivery recorded.";
  if (status === "Denied") return "Access was not approved.";
  if (status === "Expired") return "No decision before the deadline.";
  if (status === "Receipt unconfirmed")
    return "The window ended without a confirmed receipt.";
  if (status === "Not collected") return "Approved, but never collected.";
  if (status === "Waiting for pickup")
    return "Approved. The agent has not collected access yet.";
  if (status === "Waiting for receipt")
    return "Delivery started. Receipt is not confirmed yet.";
  if (status === "Received") return "The agent confirmed receipt.";
  return "Waiting for your decision.";
}
export function requestTime(r: ApprovalRequest, now: number) {
  if (r.stoppedAt) return r.stoppedAt;
  if (r.requesterStoppedAt && r.status !== "denied" && r.status !== "cancelled")
    return r.requesterStoppedAt;
  if (r.receivedAt) return r.receivedAt;
  if (
    r.status !== "denied" &&
    r.status !== "cancelled" &&
    deliveryDeadline(r) <= now
  )
    return deliveryDeadline(r);
  return r.deliveredAt ?? r.decidedAt ?? r.createdAt;
}
export function requestTimeline(
  r: ApprovalRequest,
  now: number,
): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { label: "Requested", at: r.createdAt, tone: "done" },
  ];
  const approved =
    r.status === "approved" ||
    (!!r.decidedAt && r.status === "cancelled") ||
    !!r.deliveredAt ||
    !!r.receivedAt;
  if (r.status === "denied")
    events.push({ label: "Denied", at: r.decidedAt, tone: "stopped" });
  else if (approved)
    events.push({ label: "Approved", at: r.decidedAt, tone: "done" });
  if (r.deliveredAt)
    events.push({
      label: "Delivery attempted",
      at: r.deliveredAt,
      tone: "done",
    });
  if (r.receivedAt)
    events.push({ label: "Receipt confirmed", at: r.receivedAt, tone: "done" });
  const deadline = deliveryDeadline(r);
  if (
    r.status !== "denied" &&
    deadline <= now &&
    (r.status !== "cancelled" || (!!r.stoppedAt && deadline < r.stoppedAt)) &&
    (r.accountAvailable ||
      (!!r.accountBlockedAt && deadline < r.accountBlockedAt)) &&
    (!r.requesterStopped ||
      (!!r.requesterStoppedAt && deadline < r.requesterStoppedAt))
  )
    events.push({
      label:
        r.status === "pending" ? "Request expired" : "Delivery window ended",
      at: deadline,
      tone: r.receivedAt ? "done" : "stopped",
      detail: r.receivedAt
        ? undefined
        : r.status === "pending"
          ? "No decision was made."
          : r.deliveredAt
            ? "Receipt was not confirmed."
            : "Access was not collected.",
    });
  if (r.status === "cancelled")
    events.push({
      label: "Delivery stopped",
      at: r.stoppedAt,
      tone: "stopped",
      detail: r.receivedAt
        ? "Previously received access is unaffected."
        : undefined,
    });
  else if (!r.accountAvailable && r.status !== "denied")
    events.push({
      label: "Account sharing blocked",
      at: r.accountBlockedAt,
      tone: "stopped",
      detail: r.receivedAt
        ? "Previously received access is unaffected."
        : undefined,
    });
  else if (r.requesterStopped && r.status !== "denied")
    events.push({
      label: "Connection sharing stopped",
      at: r.requesterStoppedAt,
      tone: "stopped",
    });
  else if (deadline > now && r.status !== "denied" && !r.receivedAt)
    events.push({
      label:
        r.status === "pending"
          ? "Waiting for your decision"
          : r.deliveredAt
            ? "Waiting for receipt"
            : "Waiting for pickup",
      detail: `Until ${formatRequestTime(deadline)}`,
      tone: "waiting",
    });
  return events;
}
export function formatRequestTime(at: number) {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
export async function approvalPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      "The request could not be completed. Check your sign-in and try again.",
    );
  return response.json();
}

export function requestAccess(r: ApprovalRequest) {
  return r.reason;
}
export function accessBoundary(r: ApprovalRequest) {
  return r.snapshot.accessDescription;
}
