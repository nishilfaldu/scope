import type { GenericMutationCtx } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { DataModel } from "../_generated/dataModel";

export async function ensurePassport(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
) {
  const existing = await ctx.db
    .query("passports")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (existing) return existing._id;
  return await ctx.db.insert("passports", {
    userId,
    name: "Default passport",
  });
}
