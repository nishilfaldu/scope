import { v } from "convex/values";
import { authenticatedQuery } from "../../functions";
import { appValidator } from "../../domain/apps";
import { connectionsForApp } from "./helpers";

export const statusesForApps = authenticatedQuery({
  args: { apps: v.array(appValidator) },
  returns: v.array(
    v.object({
      app: appValidator,
      provider: appValidator,
      connected: v.boolean(),
      accounts: v.array(
        v.object({
          id: v.id("connections"),
          login: v.string(),
          providerUserId: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    if (new Set(args.apps).size !== args.apps.length)
      throw new Error("Apps must be distinct");
    return await Promise.all(
      args.apps.map(async (app) => {
        const rows = await connectionsForApp(ctx, ctx.userId, app);
        return {
          app,
          provider: app,
          connected: rows.length > 0,
          accounts: rows.map((row) => ({
            id: row._id,
            login: row.login,
            providerUserId: row.providerUserId,
          })),
        };
      }),
    );
  },
});
