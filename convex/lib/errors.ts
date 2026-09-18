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
  "IDEMPOTENCY_CONFLICT",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const AGENT_ERROR_GUIDANCE: Record<AgentErrorCode, { retryable: boolean; nextAction: string }> = {
  UNAUTHORIZED: { retryable: false, nextAction: "Check the private credentials or request access again." },
  REVOKED: { retryable: false, nextAction: "Ask the operator for a new grant." },
  EXPIRED: { retryable: false, nextAction: "Request a new grant." },
  APP_UNAVAILABLE: { retryable: false, nextAction: "Ask the operator to reconnect or rebind this app." },
  INVALID_REQUEST: { retryable: false, nextAction: "Correct the request before retrying." },
  PROVIDER_ERROR: { retryable: true, nextAction: "Retry later; if it persists, reconnect the provider." },
  SHORT_LIVED_UNAVAILABLE: { retryable: false, nextAction: "Use a provider connection that supports fresh short-lived tokens." },
  APPROVAL_REQUIRED: { retryable: true, nextAction: "Show the approval URL to the operator and wait for their decision." },
  APPROVAL_DENIED: { retryable: false, nextAction: "Respect the denial; make a new request only if the operator asks." },
  APPROVAL_EXPIRED: { retryable: false, nextAction: "Start a new approval request." },
  IDEMPOTENCY_CONFLICT: { retryable: false, nextAction: "Use the original payload or a new idempotency key." },
};

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
  v.literal("IDEMPOTENCY_CONFLICT"),
);

export const APP_UNAVAILABLE_ERROR =
  "This app is not available to this slice";

export const UNAUTHORIZED_ERROR = "Unknown slice token or slice secret";

export const REVOKED_ERROR = "Slice revoked";

export const EXPIRED_ERROR = "Slice expired";

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
