import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AgentErrorCode } from "../../lib/errors";
import { hashesEqual, sha256Hex } from "../../lib/secrets";

export const MAX_SLICE_NAME = 80;
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type MintPolicy = "auto" | "approve";

export function effectiveMintPolicy(
  slice: Pick<Doc<"slices">, "mintPolicy">,
): MintPolicy {
  return slice.mintPolicy === "approve" ? "approve" : "auto";
}

export function withoutSecretHash(slice: Doc<"slices">) {
  return {
    _id: slice._id,
    _creationTime: slice._creationTime,
    passportId: slice.passportId,
    grantId: slice.grantId,
    userId: slice.userId,
    name: slice.name,
    token: slice.token,
    status: slice.status,
    expiresAt: slice.expiresAt,
    mintPolicy: effectiveMintPolicy(slice),
  };
}

export async function sliceBySecret(
  ctx: QueryCtx,
  args: { sliceToken: string; sliceSecret: string },
): Promise<Doc<"slices"> | null> {
  const slice = await ctx.db
    .query("slices")
    .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
    .unique();
  if (!slice) {
    return null;
  }
  const secretHash = await sha256Hex(args.sliceSecret);
  if (!hashesEqual(secretHash, slice.secretHash)) {
    return null;
  }
  return slice;
}

export async function markExpired(
  ctx: MutationCtx,
  slice: Doc<"slices">,
): Promise<void> {
  if (slice.status !== "active") return;
  await ctx.db.patch("slices", slice._id, { status: "expired" });
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
