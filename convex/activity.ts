import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { ownerId } from "./lib/identity";
import schema from "./schema";

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      ...schema.tables.calls.validator.fields,
      _id: v.id("calls"),
      _creationTime: v.number(),
      clientName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const owner = await ownerId(ctx);
    const page = await ctx.db
      .query("calls")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", owner))
      .order("desc")
      .paginate(args.paginationOpts);
    const names = new Map<string, string>();
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (call) => {
          if (!names.has(call.clientId))
            names.set(
              call.clientId,
              (await ctx.db.get("clients", call.clientId))?.name ??
                "Removed app",
            );
          return { ...call, clientName: names.get(call.clientId)! };
        }),
      ),
    };
  },
});
