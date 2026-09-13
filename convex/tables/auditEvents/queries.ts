import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  actorTypeValidator,
  auditKindValidator,
  outcomeValidator,
} from "./fields";

const auditEventDoc = schema.doc("auditEvents");

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
