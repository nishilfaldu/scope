import { v } from "convex/values";

export const AGENT_ERROR_CODES = [
  "UNAUTHORIZED",
  "REVOKED",
  "EXPIRED",
  "APP_UNAVAILABLE",
  "INVALID_REQUEST",
  "PROVIDER_ERROR",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const agentErrorCodeValidator = v.union(
  v.literal("UNAUTHORIZED"),
  v.literal("REVOKED"),
  v.literal("EXPIRED"),
  v.literal("APP_UNAVAILABLE"),
  v.literal("INVALID_REQUEST"),
  v.literal("PROVIDER_ERROR"),
);

export const APP_UNAVAILABLE_ERROR =
  "This app is not available to this slice";

export const UNAUTHORIZED_ERROR = "Unknown slice token or slice secret";

export const denyResultValidator = v.object({
  ok: v.literal(false),
  status: v.number(),
  reason: v.string(),
  code: agentErrorCodeValidator,
});
