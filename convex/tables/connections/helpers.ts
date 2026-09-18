import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { providerForApp, type AppId } from "../../domain/apps";

export async function connectionsForApp(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  userId: Id<"users">,
  app: AppId,
) {
  return await ctx.db.query("connections")
    .withIndex("by_user_provider_app_providerUserId", (q) =>
      q.eq("userId", userId).eq("provider", providerForApp(app)).eq("app", app),
    ).collect();
}

export async function selectedConnection(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  userId: Id<"users">,
  app: AppId,
  connectionId: Id<"connections">,
) {
  const row = await ctx.db.get("connections", connectionId);
  return row && row.userId === userId && row.app === app && row.provider === providerForApp(app) ? row : null;
}
