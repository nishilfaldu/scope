import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AgentErrorCode } from "../../agentErrors";
import { hashesEqual, sha256Hex } from "../../secrets";

export function withoutInvokeKey(passport: Doc<"passports">) {
  return {
    _id: passport._id,
    _creationTime: passport._creationTime,
    name: passport.name,
    token: passport.token,
    status: passport.status,
    expiresAt: passport.expiresAt,
    apps: passport.apps,
  };
}

export async function passportByInvokeKey(
  ctx: QueryCtx,
  args: { token: string; invokeKey: string },
): Promise<Doc<"passports"> | null> {
  const passport = await ctx.db
    .query("passports")
    .withIndex("by_token", (q) => q.eq("token", args.token))
    .unique();
  if (!passport?.invokeKeyHash) {
    return null;
  }
  const invokeHash = await sha256Hex(args.invokeKey);
  if (!hashesEqual(invokeHash, passport.invokeKeyHash)) {
    return null;
  }
  return passport;
}

export async function markExpired(
  ctx: MutationCtx,
  passport: Doc<"passports">,
): Promise<void> {
  if (passport.status !== "active") return;
  await ctx.db.patch("passports", passport._id, { status: "expired" });
}

export function denyCreate(
  status: number,
  reason: string,
  code: AgentErrorCode,
): {
  ok: false;
  status: number;
  reason: string;
  code: AgentErrorCode;
} {
  return { ok: false, status, reason, code };
}
