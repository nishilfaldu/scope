import type { Doc } from "@/convex/_generated/dataModel";

export type ApprovalAccount = Pick<
  Doc<"probeAccounts">,
  "_id" | "label" | "providerUserId" | "revoked" | "credentialKind" | "baseId"
>;
export type ApprovalRequest = Pick<
  Doc<"probeRequests">,
  | "_id"
  | "accountId"
  | "reason"
  | "requester"
  | "status"
  | "expiresAt"
  | "deliveredAt"
  | "receivedAt"
  | "decidedAt"
>;

export function approvalStatus(
  request: ApprovalRequest,
  now: number,
  blocked = false,
) {
  if (request.status === "denied") return "Denied";
  if (request.status === "cancelled") return "Delivery stopped";
  if (blocked) return "Account blocked";
  if (request.expiresAt <= now) return "Expired";
  return request.status === "approved" ? "Approved" : "Needs approval";
}

export function receiptDescription(
  request: ApprovalRequest,
  now: number,
  blocked = false,
) {
  if (request.receivedAt)
    return `Helper confirmed receipt ${new Date(request.receivedAt).toLocaleString()}.`;
  if (
    request.status === "cancelled" ||
    request.status === "denied" ||
    blocked ||
    request.expiresAt <= now
  )
    return request.deliveredAt
      ? "Delivery was attempted; receipt was not confirmed."
      : "No access was delivered.";
  return request.deliveredAt
    ? "Delivery attempted; waiting for the helper to confirm receipt."
    : request.status === "approved"
      ? "Waiting for the helper to collect access."
      : "Access stays blocked until you approve.";
}

export async function approvalPost<T>(
  operation: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`/api/probe/${operation}`, {
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
