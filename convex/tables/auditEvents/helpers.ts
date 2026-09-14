import { type Infer, v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { PROVIDERS } from "../../permissions";
import {
  auditKindValidator,
  hashAuditEvent,
  outcomeValidator,
  type ActorType,
  type AuditKind,
  type HashInput,
  type Outcome,
} from "./fields";

export const lastEventValidator = v.object({
  kind: auditKindValidator,
  outcome: outcomeValidator,
  action: v.union(v.string(), v.null()),
  reason: v.string(),
  occurredAt: v.number(),
});

type LastEvent = Infer<typeof lastEventValidator>;

export async function boardActorId(ctx: MutationCtx): Promise<string> {
  for (const provider of PROVIDERS) {
    const row = await ctx.db
      .query("connections")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .unique();
    if (row?.login) return row.login;
  }
  return "board";
}

export async function markExpired(
  ctx: MutationCtx,
  passport: Doc<"passports">,
  now: number,
): Promise<Doc<"passports">> {
  if (passport.status !== "active") return passport;
  await ctx.db.patch("passports", passport._id, { status: "expired" });
  await appendAuditEvent(ctx, {
    passportId: passport._id,
    kind: "expired",
    actorType: "system",
    actorId: "expiry",
    scopes: [...passport.apps],
    outcome: "denied",
    reason: "Time to live elapsed",
    service: null,
    action: null,
    argsPreview: null,
    httpStatus: null,
    app: null,
    occurredAt: now,
  });
  const updated = await ctx.db.get("passports", passport._id);
  if (!updated) throw new Error("Passport not found");
  return updated;
}

export async function latestEvent(
  ctx: QueryCtx,
  passportId: Id<"passports">,
): Promise<LastEvent | null> {
  const events = await ctx.db
    .query("auditEvents")
    .withIndex("by_passport", (q) => q.eq("passportId", passportId))
    .order("desc")
    .take(1);
  const event = events[0];
  if (!event) return null;
  return {
    kind: event.kind,
    outcome: event.outcome,
    action: event.action,
    reason: event.reason,
    occurredAt: event.occurredAt,
  };
}

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
  app: string | null;
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
    app?: string | null;
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
    app: input.app ?? null,
    occurredAt: input.occurredAt,
  };
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
      app: event.app ?? event.platform ?? null,
      occurredAt: event.occurredAt,
    },
    event.seq,
    event.prevHash,
  );
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
