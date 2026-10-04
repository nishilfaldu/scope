import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
export type ApprovalAccount = FunctionReturnType<
  typeof api.accounts.forOwner
>[number];
export type ApprovalRequest = FunctionReturnType<
  typeof api.approvals.forOwner
>["page"][number];
export type RequestDecision = {
  label: "Approved" | "Denied" | "Expired" | "Not decided" | "Cancelled";
  at?: number;
};
export type RequestDelivery = {
  label:
    | "Waiting for pickup"
    | "Waiting for receipt"
    | "Received"
    | "Not collected"
    | "Receipt unconfirmed"
    | "Delivery stopped";
  at?: number;
};
export type RequestEvent = { label: string; at?: number };

export function accountName(label?: string) {
  return label?.trim() || "Unavailable account";
}
export function deliveryDeadline(r: ApprovalRequest) {
  return r.approvalExpiresAt;
}
export function requestDecision(r: ApprovalRequest): RequestDecision {
  if (r.status === "denied") return { label: "Denied", at: r.decidedAt };
  if (
    r.status === "approved" ||
    (r.status === "cancelled" && r.decidedAt !== undefined) ||
    r.deliveredAt !== undefined ||
    r.receivedAt !== undefined
  )
    return { label: "Approved", at: r.decidedAt };
  if (r.status === "cancelled") return { label: "Cancelled", at: r.stoppedAt };
  if (r.expiredAt !== undefined)
    return { label: "Expired", at: deliveryDeadline(r) };
  return { label: "Not decided" };
}
export function requestDelivery(
  r: ApprovalRequest,
): RequestDelivery | undefined {
  if (requestDecision(r).label !== "Approved") return undefined;
  if (r.receivedAt !== undefined)
    return { label: "Received", at: r.receivedAt };
  const deadline = deliveryDeadline(r);
  if (
    r.status === "cancelled" &&
    (r.stoppedAt === undefined || r.stoppedAt < deadline)
  )
    return { label: "Delivery stopped", at: r.stoppedAt };
  if (r.expiredAt !== undefined)
    return {
      label:
        r.deliveredAt !== undefined ? "Receipt unconfirmed" : "Not collected",
      at: deadline,
    };
  return r.deliveredAt !== undefined
    ? { label: "Waiting for receipt", at: r.deliveredAt }
    : { label: "Waiting for pickup" };
}
export function approvalStatus(r: ApprovalRequest) {
  // Current connection authority gates actions, never historical request facts.
  if (
    r.status === "pending" &&
    r.expiredAt === undefined &&
    r.accountAvailable &&
    !r.requesterStopped
  )
    return "Needs approval";
  return requestDelivery(r)?.label ?? requestDecision(r).label;
}
export function requestActivity(r: ApprovalRequest): RequestEvent[] {
  const events: RequestEvent[] = [{ label: "Requested", at: r.createdAt }];
  const decision = requestDecision(r),
    delivery = requestDelivery(r);
  if (decision.label === "Approved" || decision.label === "Denied")
    events.push(decision);
  if (r.deliveredAt !== undefined)
    events.push({ label: "Delivery attempted", at: r.deliveredAt });
  if (r.receivedAt !== undefined)
    events.push({ label: "Received", at: r.receivedAt });
  if (decision.label === "Expired")
    events.push({ label: "Request expired", at: decision.at });
  if (decision.label === "Cancelled") events.push(decision);
  if (
    delivery &&
    ["Not collected", "Receipt unconfirmed", "Delivery stopped"].includes(
      delivery.label,
    )
  )
    events.push(delivery);
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
