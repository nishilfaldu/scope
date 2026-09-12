import { v } from "convex/values";

export const AGENT_ERROR_CODES = [
  "unauthorized",
  "revoked",
  "expired",
  "platform_unavailable",
  "action_unavailable",
  "invalid_request",
  "provider_error",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const agentErrorCodeValidator = v.union(
  v.literal("unauthorized"),
  v.literal("revoked"),
  v.literal("expired"),
  v.literal("platform_unavailable"),
  v.literal("action_unavailable"),
  v.literal("invalid_request"),
  v.literal("provider_error"),
);

export const PLATFORM_UNAVAILABLE_ERROR =
  "This platform is not available on this passport";

export const ACTION_UNAVAILABLE_ERROR =
  "This action is not available on this passport";

export const UNAUTHORIZED_ERROR = "Unknown passport or invoke key";

export const denyResultValidator = v.object({
  ok: v.literal(false),
  status: v.number(),
  reason: v.string(),
  code: agentErrorCodeValidator,
});
