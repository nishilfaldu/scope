import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AppId } from "../../domain/apps";

export async function connectionsForApp(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  userId: Id<"users">,
  app: AppId,
) {
  return await ctx.db
    .query("connections")
    .withIndex("by_user_app_providerUserId", (q) =>
      q.eq("userId", userId).eq("app", app),
    )
    .take(100);
}
