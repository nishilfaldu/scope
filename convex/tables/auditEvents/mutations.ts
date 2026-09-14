import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { markExpired } from "./helpers";

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
