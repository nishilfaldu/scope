import type { MutationCtx } from "../../_generated/server";
import type { GenericId } from "convex/values";
import type { AppId } from "../../domain/apps";

export async function insertGrant(
  ctx: MutationCtx,
  args: {
    passportId: GenericId<"passports">;
    userId?: GenericId<"users">;
    agent: string;
    apps: AppId[];
    expiresAt: number;
  },
): Promise<GenericId<"grants">> {
  return await ctx.db.insert("grants", args);
}
