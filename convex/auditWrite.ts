import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  hashAuditEvent,
  type ActorType,
  type AuditKind,
  type HashInput,
  type Outcome,
} from "./auditFields";

export type AppendInput = {
  passportId: Id<"passports">;
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
  platform: string | null;
  occurredAt: number;
};

export function asHashInput(
  input: {
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
    platform?: string | null;
    occurredAt: number;
  },
  seq: number,
  prevHash: string | null,
): HashInput {
  return {
    seq,
    prevHash,
    kind: input.kind,
    actorType: input.actorType,
    actorId: input.actorId,
    scopes: input.scopes,
    outcome: input.outcome,
    reason: input.reason,
    service: input.service,
    action: input.action,
    argsPreview: input.argsPreview,
    httpStatus: input.httpStatus,
    platform: input.platform ?? null,
    occurredAt: input.occurredAt,
  };
}

export async function appendAuditEvent(
  ctx: MutationCtx,
  input: AppendInput,
): Promise<void> {
  const passport = await ctx.db.get("passports", input.passportId);
  if (!passport) {
    throw new Error("Passport not found");
  }
  const prevSeq = passport.auditSeq ?? 0;
  const prevHash = passport.auditHeadHash ?? null;
  const seq = prevSeq + 1;
  const scopes = [...new Set(input.scopes)];
  const normalized = { ...input, scopes };
  const hash = await hashAuditEvent(asHashInput(normalized, seq, prevHash));
  await ctx.db.insert("auditEvents", {
    ...normalized,
    seq,
    prevHash,
    hash,
  });
  await ctx.db.patch("passports", passport._id, {
    auditSeq: seq,
    auditHeadHash: hash,
  });
}

export function passportDocForHash(event: Doc<"auditEvents">): HashInput {
  return asHashInput(
    {
      kind: event.kind,
      actorType: event.actorType,
      actorId: event.actorId,
      scopes: event.scopes,
      outcome: event.outcome,
      reason: event.reason,
      service: event.service,
      action: event.action,
      argsPreview: event.argsPreview,
      httpStatus: event.httpStatus,
      platform: event.platform ?? null,
      occurredAt: event.occurredAt,
    },
    event.seq,
    event.prevHash,
  );
}
