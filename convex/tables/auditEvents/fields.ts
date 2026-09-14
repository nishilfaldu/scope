import { v } from "convex/values";
import { sha256Hex } from "../../secrets";

export const AUDIT_KINDS = [
  "issued",
  "app_toggled",
  "revoked",
  "expired",
  "token_issued",
  "token_refreshed",
  "token_revoked",
  "create_denied",
] as const;

export const ACTOR_TYPES = ["board", "agent", "system"] as const;

export const OUTCOMES = ["allowed", "denied"] as const;

export type AuditKind = (typeof AUDIT_KINDS)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];
export type Outcome = (typeof OUTCOMES)[number];

export const auditKindValidator = v.union(
  v.literal("issued"),
  v.literal("app_toggled"),
  v.literal("platform_toggled"),
  v.literal("revoked"),
  v.literal("expired"),
  v.literal("token_issued"),
  v.literal("token_refreshed"),
  v.literal("token_revoked"),
  v.literal("create_denied"),
  v.literal("presented"),
  v.literal("verified"),
  v.literal("used"),
);

export const actorTypeValidator = v.union(
  v.literal("board"),
  v.literal("agent"),
  v.literal("system"),
);

export const outcomeValidator = v.union(
  v.literal("allowed"),
  v.literal("denied"),
);

export const auditEventValidator = v.object({
  passportId: v.id("passports"),
  kind: auditKindValidator,
  actorType: actorTypeValidator,
  actorId: v.string(),
  scopes: v.array(v.string()),
  outcome: outcomeValidator,
  reason: v.string(),
  service: v.union(v.string(), v.null()),
  action: v.union(v.string(), v.null()),
  argsPreview: v.union(v.string(), v.null()),
  httpStatus: v.union(v.number(), v.null()),
  app: v.optional(v.union(v.string(), v.null())),
  platform: v.optional(v.union(v.string(), v.null())),
  occurredAt: v.number(),
  seq: v.number(),
  prevHash: v.union(v.string(), v.null()),
  hash: v.string(),
});

export type HashInput = {
  seq: number;
  prevHash: string | null;
  kind: string;
  actorType: ActorType;
  actorId: string;
  scopes: string[];
  outcome: Outcome;
  reason: string;
  service: string | null;
  action: string | null;
  argsPreview: string | null;
  httpStatus: number | null;
  app: string | null;
  occurredAt: number;
};

function canonicalAuditPayload(input: HashInput): string {
  return JSON.stringify([
    input.seq,
    input.prevHash,
    input.kind,
    input.actorType,
    input.actorId,
    input.scopes,
    input.outcome,
    input.reason,
    input.service,
    input.action,
    input.argsPreview,
    input.httpStatus,
    input.app,
    input.occurredAt,
  ]);
}

export async function hashAuditEvent(input: HashInput): Promise<string> {
  return await sha256Hex(canonicalAuditPayload(input));
}
