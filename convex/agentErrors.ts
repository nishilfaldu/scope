import { v } from "convex/values";

export const AGENT_ERROR_CODES = [
  "UNAUTHORIZED",
  "REVOKED",
  "EXPIRED",
  "PLATFORM_UNAVAILABLE",
  "INVALID_REQUEST",
  "PROVIDER_ERROR",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const agentErrorCodeValidator = v.union(
  v.literal("UNAUTHORIZED"),
  v.literal("REVOKED"),
  v.literal("EXPIRED"),
  v.literal("PLATFORM_UNAVAILABLE"),
  v.literal("INVALID_REQUEST"),
  v.literal("PROVIDER_ERROR"),
);

export const PLATFORM_UNAVAILABLE_ERROR =
  "This platform is not available on this passport";

export const UNAUTHORIZED_ERROR = "Unknown passport or invoke key";

export const denyResultValidator = v.object({
  ok: v.literal(false),
  status: v.number(),
  reason: v.string(),
  code: agentErrorCodeValidator,
});
