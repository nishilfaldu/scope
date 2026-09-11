import { v } from "convex/values";

export const AUDIT_KINDS = [
  "issued",
  "presented",
  "verified",
  "used",
  "revoked",
  "expired",
] as const;

export const ACTOR_TYPES = ["board", "agent", "system"] as const;

export const OUTCOMES = ["allowed", "denied"] as const;

export type AuditKind = (typeof AUDIT_KINDS)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];
export type Outcome = (typeof OUTCOMES)[number];

export const auditKindValidator = v.union(
  v.literal("issued"),
  v.literal("presented"),
  v.literal("verified"),
  v.literal("used"),
  v.literal("revoked"),
  v.literal("expired"),
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
  occurredAt: v.number(),
  seq: v.number(),
  prevHash: v.union(v.string(), v.null()),
  hash: v.string(),
});

export type HashInput = {
  seq: number;
  prevHash: string | null;
  kind: AuditKind;
  actorType: ActorType;
  actorId: string;
  scopes: string[];
  outcome: Outcome;
  reason: string;
  service: string | null;
  action: string | null;
  argsPreview: string | null;
  httpStatus: number | null;
  occurredAt: number;
};

export function canonicalAuditPayload(input: HashInput): string {
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
    input.occurredAt,
  ]);
}

export async function hashAuditEvent(input: HashInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalAuditPayload(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
