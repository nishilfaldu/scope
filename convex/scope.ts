import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type Infer } from "convex/values";
import { env, type QueryCtx, type MutationCtx } from "./_generated/server";
import { hashesEqual } from "./lib/secrets";

export const connectReference = v.object({
  connectorId: v.string(),
  subjectId: v.string(),
  issuer: v.string(),
  installationId: v.optional(v.string()),
});
export const supersededGrant = v.object({
  integrationId: v.string(),
  connect: connectReference,
  profileId: v.string(),
  profileVersion: v.number(),
});
export const principal = v.object({
  issuer: v.string(),
  subject: v.string(),
  clientId: v.string(),
  consentId: v.string(),
});
export const actor = principal.extend({
  userId: v.id("users"),
  secret: v.string(),
});
export const decision = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("cancelled"),
);
export const disconnectOutcome = v.union(
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("unsupported"),
);
export const snapshot = v.object({
  accountLabel: v.string(),
  providerName: v.string(),
  accessDescription: v.string(),
  providerEmail: v.optional(v.string()),
  baseName: v.optional(v.string()),
  requesterName: v.string(),
  collectorName: v.string(),
});
export type Actor = Infer<typeof actor>;
export type Ctx = QueryCtx | MutationCtx;
export async function owner(ctx: Ctx) {
  const id = await getAuthUserId(ctx);
  if (!id) throw new Error("Sign in required");
  return id;
}
export function service(secret: string) {
  const expected = env.SCOPE_SERVICE_SECRET;
  if (!expected || !hashesEqual(expected, secret))
    throw new Error("Unauthorized");
}
export async function verifiedActor(ctx: Ctx, args: Actor) {
  service(args.secret);
  if (
    args.subject !== `scope:${args.userId}` ||
    !args.issuer.trim() ||
    !args.clientId.trim() ||
    !args.consentId.trim() ||
    !(await ctx.db.get("users", args.userId))
  )
    throw new Error("Unauthorized");
}
export function collectorEligible(clientId: string) {
  return (
    !!env.SCOPE_HELPER_CLIENT_ID && clientId === env.SCOPE_HELPER_CLIENT_ID
  );
}
export async function clientActor(ctx: Ctx, args: Actor, allowStopped = false) {
  await verifiedActor(ctx, args);
  const row = await ctx.db
    .query("clientConnections")
    .withIndex("by_issuer_and_subject_and_clientId_and_consentId", (q) =>
      q
        .eq("issuer", args.issuer)
        .eq("subject", args.subject)
        .eq("clientId", args.clientId)
        .eq("consentId", args.consentId),
    )
    .unique();
  if (
    !row ||
    row.ownerId !== args.userId ||
    (!allowStopped && row.stoppedAt !== undefined)
  )
    throw new Error("Connection unavailable");
  return row;
}
