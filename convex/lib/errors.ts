import { v } from "convex/values";

export const AGENT_ERROR_CODES = [
  "UNAUTHORIZED",
  "REVOKED",
  "EXPIRED",
  "APP_UNAVAILABLE",
  "INVALID_REQUEST",
  "PROVIDER_ERROR",
  "SHORT_LIVED_UNAVAILABLE",
  "APPROVAL_REQUIRED",
  "APPROVAL_DENIED",
  "APPROVAL_EXPIRED",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const agentErrorCodeValidator = v.union(
  v.literal("UNAUTHORIZED"),
  v.literal("REVOKED"),
  v.literal("EXPIRED"),
  v.literal("APP_UNAVAILABLE"),
  v.literal("INVALID_REQUEST"),
  v.literal("PROVIDER_ERROR"),
  v.literal("SHORT_LIVED_UNAVAILABLE"),
  v.literal("APPROVAL_REQUIRED"),
  v.literal("APPROVAL_DENIED"),
  v.literal("APPROVAL_EXPIRED"),
);

export const APP_UNAVAILABLE_ERROR =
  "This app is not available to this slice";

export const UNAUTHORIZED_ERROR = "Unknown slice token or slice secret";

export const APPROVAL_REQUIRED_ERROR =
  "Operator approval required before this credential can be minted";

export const APPROVAL_DENIED_ERROR = "Credential request was denied";

export const APPROVAL_EXPIRED_ERROR = "Credential request expired";

export const SHORT_LIVED_UNAVAILABLE_ERROR =
  "Provider cannot mint a short-lived access token without handing off the vault standing token";

export const denyResultValidator = v.object({
  ok: v.literal(false),
  status: v.number(),
  reason: v.string(),
  code: agentErrorCodeValidator,
});
