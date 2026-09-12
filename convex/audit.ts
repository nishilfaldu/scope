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
import { PROVIDERS } from "./permissions";
import schema from "./schema";
import { revokeLivePlatformTokens } from "./tokens";
import { appendAuditEvent, passportDocForHash } from "./auditWrite";
import {
  actorTypeValidator,
  auditKindValidator,
  hashAuditEvent,
  outcomeValidator,
} from "./auditFields";

export { appendAuditEvent };

const auditEventDoc = schema.doc("auditEvents");

export const lastEventValidator = v.object({
  kind: auditKindValidator,
  outcome: outcomeValidator,
  action: v.union(v.string(), v.null()),
  reason: v.string(),
  occurredAt: v.number(),
});

type LastEvent = Infer<typeof lastEventValidator>;

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
    { actorType: "system", actorId: "expiry" },
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
    platform: null,
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
      const expectedHash = await hashAuditEvent(passportDocForHash(event));
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

export const wipeDevLogs = internalMutation({
  args: {},
  returns: v.object({
    auditEvents: v.number(),
    passports: v.number(),
  }),
  handler: async (ctx) => {
    let auditEvents = 0;
    for (;;) {
      const page = await ctx.db.query("auditEvents").take(100);
      if (page.length === 0) {
        break;
      }
      for (const row of page) {
        await ctx.db.delete("auditEvents", row._id);
        auditEvents += 1;
      }
    }
    let passports = 0;
    let cursor: string | null = null;
    for (;;) {
      const result = await ctx.db.query("passports").paginate({
        numItems: 100,
        cursor,
      });
      for (const passport of result.page) {
        await ctx.db.replace("passports", passport._id, {
          name: passport.name,
          token: passport.token,
          ...(passport.invokeKeyHash !== undefined
            ? { invokeKeyHash: passport.invokeKeyHash }
            : {}),
          status: passport.status,
          expiresAt: passport.expiresAt,
          apps: passport.apps,
          auditSeq: 0,
        });
        passports += 1;
      }
      if (result.isDone) {
        break;
      }
      cursor = result.continueCursor;
    }
    return { auditEvents, passports };
  },
});
