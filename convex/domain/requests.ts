import { v } from "convex/values";

export const storedRequestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("claimed"),
);
export const requestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("claimed"),
  v.literal("expired"),
);
export const requestKindValidator = v.union(
  v.literal("onboarding"),
  v.literal("mint"),
);

export function effectiveRequestStatus<
  T extends {
    status: "pending" | "approved" | "denied" | "claimed";
    expiresAt: number;
  },
>(request: T, now: number): T["status"] | "expired" {
  return (request.status === "pending" || request.status === "approved") &&
    request.expiresAt <= now
    ? "expired"
    : request.status;
}
