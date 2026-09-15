import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { insertGrant } from "./tables/grants/helpers";

// One-time backfill for the passport/slice reshape. Run after deploying the
// new schema:
//
//   npx convex run migrations:toSlices
//
// It links every unowned connection to the default passport and converts each
// legacy passports row (the old pp_/ps_ credentials) into a slice plus its
// grant record, then deletes the legacy row. Everything binds to the first
// user's passport (or a fresh unowned one when no user exists yet), which
// matches the single-owner data this app has today. Safe to rerun: a second
// run finds nothing unlinked and no legacy rows.
export const toSlices = internalMutation({
  args: {},
  returns: v.object({
    passportsCreated: v.number(),
    connectionsLinked: v.number(),
    slicesCreated: v.number(),
  }),
  handler: async (ctx) => {
    const passports = await ctx.db.query("passports").collect();
    let defaultPassport = passports.find((row) => !("token" in row));
    let passportsCreated = 0;
    if (!defaultPassport) {
      const firstUser = await ctx.db.query("users").first();
      const id = await ctx.db.insert(
        "passports",
        firstUser
          ? { userId: firstUser._id, name: "Default passport" }
          : { name: "Default passport" },
      );
      const created = await ctx.db.get("passports", id);
      if (!created) {
        throw new Error("Failed to create the default passport");
      }
      defaultPassport = created;
      passportsCreated = 1;
    }
    const passportId = defaultPassport._id;
    const userId =
      "userId" in defaultPassport ? defaultPassport.userId : undefined;

    let connectionsLinked = 0;
    for (const connection of await ctx.db.query("connections").collect()) {
      if (connection.passportId) {
        continue;
      }
      await ctx.db.patch("connections", connection._id, { passportId });
      connectionsLinked += 1;
    }

    let slicesCreated = 0;
    for (const legacy of passports) {
      if (!("token" in legacy)) {
        continue;
      }
      const grantId = await insertGrant(ctx, {
        passportId,
        userId,
        agent: legacy.name,
        apps: legacy.apps,
        expiresAt: legacy.expiresAt,
      });
      await ctx.db.insert("slices", {
        passportId,
        grantId,
        userId,
        name: legacy.name,
        token: legacy.token,
        secretHash: legacy.passportSecretHash,
        status: legacy.status,
        apps: legacy.apps,
        expiresAt: legacy.expiresAt,
      });
      await ctx.db.delete("passports", legacy._id);
      slicesCreated += 1;
    }

    return { passportsCreated, connectionsLinked, slicesCreated };
  },
});
