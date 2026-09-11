import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { Infer, v } from "convex/values";
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { lookupAction } from "./invoke";
import { PROVIDERS } from "./permissions";
import schema from "./schema";
import { revokeLivePlatformTokens } from "./tokens";
import {
  actorTypeValidator,
  auditKindValidator,
  hashAuditEvent,
  outcomeValidator,
  type ActorType,
  type AuditKind,
  type HashInput,
  type Outcome,
} from "./auditFields";

const auditEventDoc = schema.doc("auditEvents");

export const lastEventValidator = v.object({
  kind: auditKindValidator,
  outcome: outcomeValidator,
  action: v.union(v.string(), v.null()),
  reason: v.string(),
  occurredAt: v.number(),
});

type LastEvent = Infer<typeof lastEventValidator>;

type AppendInput = {
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
  occurredAt: number;
};

function asHashInput(
  input: AppendInput,
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
    occurredAt: input.occurredAt,
  };
}

export function lifetimeStatus(
  passport: Pick<Doc<"passports">, "status" | "expiresAt">,
  now: number,
): "active" | "revoked" | "expired" {
  if (passport.status === "revoked") {
    return "revoked";
  }
  if (passport.status === "expired" || passport.expiresAt <= now) {
    return "expired";
  }
  return "active";
}

export async function boardActorId(ctx: MutationCtx): Promise<string> {
  for (const provider of PROVIDERS) {
    const row = await ctx.db
      .query("connections")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .unique();
    if (row?.login) {
      return row.login;
    }
  }
  return "board";
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

export async function markExpired(
  ctx: MutationCtx,
  passport: Doc<"passports">,
  now: number,
): Promise<Doc<"passports">> {
  if (passport.status !== "active") {
    return passport;
  }
  await ctx.db.patch("passports", passport._id, { status: "expired" });
  await revokeLivePlatformTokens(
    ctx,
    passport._id,
    null,
    "Passport expired",
    now,
  );
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
    occurredAt: now,
  });
  const updated = await ctx.db.get("passports", passport._id);
  if (!updated) {
    throw new Error("Passport not found");
  }
  return updated;
}

export async function latestEvent(
  ctx: QueryCtx,
  passportId: Id<"passports">,
): Promise<LastEvent | null> {
  const chained = await ctx.db
    .query("auditEvents")
    .withIndex("by_passport", (q) => q.eq("passportId", passportId))
    .order("desc")
    .take(1);
  const event = chained[0];
  if (!event) {
    return null;
  }
  return {
    kind: event.kind,
    outcome: event.outcome,
    action: event.action,
    reason: event.reason,
    occurredAt: event.occurredAt,
  };
}

export const chainStatus = query({
  args: { passportId: v.string() },
  returns: v.object({
    eventCount: v.number(),
    expectedSeq: v.number(),
    intact: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("passports", args.passportId);
    if (!id) {
      return { eventCount: 0, expectedSeq: 0, intact: true };
    }
    const passport = await ctx.db.get("passports", id);
    if (!passport) {
      return { eventCount: 0, expectedSeq: 0, intact: true };
    }
    const events = await ctx.db
      .query("auditEvents")
      .withIndex("by_passport", (q) => q.eq("passportId", id))
      .order("asc")
      .take(500);
    const expectedSeq = passport.auditSeq ?? 0;
    let intact = expectedSeq === events.length || events.length === 500;
    let prevHash: string | null = null;
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (event.seq !== i + 1 || event.prevHash !== prevHash) {
        intact = false;
        break;
      }
      const expectedHash = await hashAuditEvent(
        asHashInput(event, event.seq, event.prevHash),
      );
      if (event.hash !== expectedHash) {
        intact = false;
        break;
      }
      prevHash = event.hash;
    }
    if (events.length > 0 && passport.auditHeadHash !== prevHash) {
      intact = false;
    }
    return { eventCount: events.length, expectedSeq, intact };
  },
});

export const listHistory = query({
  args: {
    passportId: v.string(),
    kind: v.optional(auditKindValidator),
    outcome: v.optional(outcomeValidator),
    actorType: v.optional(actorTypeValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(auditEventDoc),
  handler: async (ctx, args) => {
    const empty = {
      page: [] as Doc<"auditEvents">[],
      isDone: true,
      continueCursor: "",
    };
    const id = ctx.db.normalizeId("passports", args.passportId);
    if (!id) {
      return empty;
    }

    if (args.kind !== undefined) {
      const kind = args.kind;
      let indexed = ctx.db
        .query("auditEvents")
        .withIndex("by_passport_and_kind", (q) =>
          q.eq("passportId", id).eq("kind", kind),
        )
        .order("desc");
      if (args.outcome !== undefined) {
        const outcome = args.outcome;
        indexed = indexed.filter((f) => f.eq(f.field("outcome"), outcome));
      }
      if (args.actorType !== undefined) {
        const actorType = args.actorType;
        indexed = indexed.filter((f) => f.eq(f.field("actorType"), actorType));
      }
      return await indexed.paginate(args.paginationOpts);
    }

    if (args.outcome !== undefined && args.actorType === undefined) {
      const outcome = args.outcome;
      return await ctx.db
        .query("auditEvents")
        .withIndex("by_passport_and_outcome", (q) =>
          q.eq("passportId", id).eq("outcome", outcome),
        )
        .order("desc")
        .paginate(args.paginationOpts);
    }

    if (args.actorType !== undefined && args.outcome === undefined) {
      const actorType = args.actorType;
      return await ctx.db
        .query("auditEvents")
        .withIndex("by_passport_and_actorType", (q) =>
          q.eq("passportId", id).eq("actorType", actorType),
        )
        .order("desc")
        .paginate(args.paginationOpts);
    }

    let indexed = ctx.db
      .query("auditEvents")
      .withIndex("by_passport", (q) => q.eq("passportId", id))
      .order("desc");
    if (args.outcome !== undefined) {
      const outcome = args.outcome;
      indexed = indexed.filter((f) => f.eq(f.field("outcome"), outcome));
    }
    if (args.actorType !== undefined) {
      const actorType = args.actorType;
      indexed = indexed.filter((f) => f.eq(f.field("actorType"), actorType));
    }
    return await indexed.paginate(args.paginationOpts);
  },
});

export const recordPresentation = internalMutation({
  args: {
    passportId: v.id("passports"),
    action: v.string(),
    argsPreview: v.string(),
  },
  returns: v.object({
    allowRun: v.boolean(),
    status: v.number(),
    reason: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const passport = await ctx.db.get("passports", args.passportId);
    if (!passport) {
      throw new Error("Passport not found");
    }

    const spec = lookupAction(args.action);
    const requestedScopes = spec ? [spec.app, args.action] : [args.action];

    await appendAuditEvent(ctx, {
      passportId: passport._id,
      kind: "presented",
      actorType: "agent",
      actorId: "invoke",
      scopes: requestedScopes,
      outcome: "allowed",
      reason: "Presented to invoke",
      service: "invoke",
      action: args.action,
      argsPreview: args.argsPreview,
      httpStatus: null,
      occurredAt: now,
    });

    let current = passport;
    if (current.status === "active" && current.expiresAt <= now) {
      current = await markExpired(ctx, current, now);
    }

    const deny = async (status: number, reason: string) => {
      await appendAuditEvent(ctx, {
        passportId: current._id,
        kind: "verified",
        actorType: "agent",
        actorId: "invoke",
        scopes: [...current.apps, ...requestedScopes],
        outcome: "denied",
        reason,
        service: "invoke",
        action: args.action,
        argsPreview: args.argsPreview,
        httpStatus: status,
        occurredAt: Date.now(),
      });
      return { allowRun: false as const, status, reason };
    };

    if (current.status === "revoked") {
      return await deny(403, "Passport revoked");
    }
    if (current.status === "expired" || current.expiresAt <= now) {
      return await deny(403, "Passport expired");
    }
    if (!spec) {
      return await deny(400, `Unknown action: ${args.action}`);
    }
    if (!current.apps.includes(spec.app)) {
      return await deny(403, "Action not permitted");
    }

    await appendAuditEvent(ctx, {
      passportId: current._id,
      kind: "verified",
      actorType: "agent",
      actorId: "invoke",
      scopes: [...current.apps, spec.app, args.action],
      outcome: "allowed",
      reason: `Passport valid for ${args.action}`,
      service: "invoke",
      action: args.action,
      argsPreview: args.argsPreview,
      httpStatus: 200,
      occurredAt: Date.now(),
    });
    return {
      allowRun: true as const,
      status: 200,
      reason: `Passport valid for ${args.action}`,
    };
  },
});

export const recordUse = internalMutation({
  args: {
    passportId: v.id("passports"),
    action: v.string(),
    argsPreview: v.string(),
    ok: v.boolean(),
    status: v.number(),
    error: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const passport = await ctx.db.get("passports", args.passportId);
    if (!passport) {
      throw new Error("Passport not found");
    }
    const spec = lookupAction(args.action);
    await appendAuditEvent(ctx, {
      passportId: passport._id,
      kind: "used",
      actorType: "agent",
      actorId: "invoke",
      scopes: spec ? [spec.app, args.action] : [args.action],
      outcome: args.ok ? "allowed" : "denied",
      reason: args.error ?? "Action succeeded",
      service: "invoke",
      action: args.action,
      argsPreview: args.argsPreview,
      httpStatus: args.status,
      occurredAt: Date.now(),
    });
    return null;
  },
});

export const expireDue = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("passports")
      .withIndex("by_status_and_expiresAt", (q) =>
        q.eq("status", "active").lte("expiresAt", now),
      )
      .take(25);
    for (const passport of due) {
      await markExpired(ctx, passport, now);
    }
    return due.length;
  },
});
