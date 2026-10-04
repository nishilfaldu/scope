import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { failureMessage } from "@/shared/failures.mjs";
export type ApprovalAccount = FunctionReturnType<
  typeof api.accounts.forOwner
>["page"][number];
export type ApprovalRequest = FunctionReturnType<
  typeof api.access.forOwner
>["page"][number];
export type RequestEvent = { label: string; at?: number };
export function accountName(label?: string) {
  return label?.trim() || "Unavailable account";
}
export function approvalStatus(r: ApprovalRequest) {
  return r.status === "pending"
    ? "Needs approval"
    : r.status === "active"
      ? "Approved"
      : r.status === "denied"
        ? "Denied"
        : r.status === "expired"
          ? "Expired"
          : "Ended";
}
export function requestActivity(r: ApprovalRequest): RequestEvent[] {
  const events: RequestEvent[] = [{ label: "Requested", at: r._creationTime }];
  if (r.approvedAt !== undefined)
    events.push({ label: "Approved", at: r.approvedAt });
  if (r.deniedAt !== undefined)
    events.push({ label: "Denied", at: r.deniedAt });
  if (r.firstCollectedAt !== undefined)
    events.push({ label: "First token collected", at: r.firstCollectedAt });
  if (r.collectionCount > 1)
    events.push({
      label: `Last token collected · ${r.collectionCount} collections`,
      at: r.lastCollectedAt,
    });
  if (r.receivedAt !== undefined)
    events.push({ label: "Receipt confirmed", at: r.receivedAt });
  if (r.endedAt !== undefined)
    events.push({
      label: r.status === "expired" ? "Expired" : "Ended",
      at: r.endedAt,
    });
  return events.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
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
  const result = await response.json();
  if (!response.ok) throw new Error(failureMessage(result.code));
  return result;
}
