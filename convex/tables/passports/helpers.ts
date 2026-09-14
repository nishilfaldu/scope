import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AgentErrorCode } from "../../lib/errors";
import { hashesEqual, sha256Hex } from "../../lib/secrets";

export function withoutPassportSecretHash(passport: Doc<"passports">) {
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

export async function passportBySecret(
  ctx: QueryCtx,
  args: { passportToken: string; passportSecret: string },
): Promise<Doc<"passports"> | null> {
  const passport = await ctx.db
    .query("passports")
    .withIndex("by_token", (q) => q.eq("token", args.passportToken))
    .unique();
  if (!passport?.passportSecretHash) {
    return null;
  }
  const secretHash = await sha256Hex(args.passportSecret);
  if (!hashesEqual(secretHash, passport.passportSecretHash)) {
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
