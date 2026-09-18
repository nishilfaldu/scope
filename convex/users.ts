import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";

export const viewer = query({
  args: {},
  returns: v.union(
    v.object({
      name: v.string(),
      email: v.string(),
      avatarUrl: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const user = await ctx.db.get("users", userId);
    if (user === null) {
      return null;
    }
    return {
      name: user.name ?? "Signed-in user",
      email: user.email ?? "",
      avatarUrl: user.image,
    };
  },
});
