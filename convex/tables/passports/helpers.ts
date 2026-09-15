import type { MutationCtx } from "../../_generated/server";
import type { GenericId } from "convex/values";

// One default passport per user for now. Multiple passports per user (work vs
// personal separation) arrive with the passport management slice.
export async function ensurePassport(
  ctx: MutationCtx,
  userId: GenericId<"users">,
): Promise<GenericId<"passports">> {
  const existing = await ctx.db
    .query("passports")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (existing && !("token" in existing)) {
    return existing._id;
  }
  return await ctx.db.insert("passports", {
    userId,
    name: "Default passport",
  });
}
