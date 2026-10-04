import { v, type Infer } from "convex/values";
import { env, type QueryCtx, type MutationCtx } from "./_generated/server";
import { hashesEqual } from "./lib/secrets";
import { canonicalScopes } from "../shared/contracts.mjs";
export { canonicalScopes } from "../shared/contracts.mjs";

export const connectReference = v.object({
  connectorId: v.string(),
  subjectId: v.string(),
  issuer: v.string(),
  installationId: v.optional(v.string()),
});
export const principal = v.object({
  issuer: v.string(),
  subject: v.string(),
  clientId: v.string(),
  sessionId: v.string(),
});
export const actor = principal.extend({
  secret: v.string(),
});
export const decision = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("cancelled"),
);
export const disconnectOutcome = v.union(
  v.literal("pending"),
  v.literal("succeeded"),
  v.literal("failed"),
);
export const command = v.object({
  argv: v.array(v.string()),
  cwd: v.string(),
  envVar: v.string(),
});
export const snapshot = v.object({
  accountLabel: v.string(),
  providerName: v.string(),
  accessDescription: v.string(),
  requesterName: v.string(),
  grantedScopes: v.array(v.string()),
});
export type Actor = Infer<typeof actor>;
export type Ctx = QueryCtx | MutationCtx;
function authIssuer() {
  return `https://api.workos.com/user_management/${env.WORKOS_CLIENT_ID}`;
}
function validUser(subject: string) {
  return /^user_[A-Za-z0-9]+$/.test(subject);
}
function validSession(sessionId: unknown): sessionId is string {
  return (
    typeof sessionId === "string" && /^session_[A-Za-z0-9]+$/.test(sessionId)
  );
}
export async function owner(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in required");
  if (
    !env.WORKOS_CLIENT_ID ||
    identity.issuer !== authIssuer() ||
    !validUser(identity.subject) ||
    identity.client_id !== env.WORKOS_CLIENT_ID ||
    !validSession(identity.sid)
  )
    throw new Error("Unauthorized");
  return identity.subject;
}
export function service(secret: string) {
  const expected = env.SCOPE_SERVICE_SECRET;
  if (!expected || !hashesEqual(expected, secret))
    throw new Error("Unauthorized");
}
// The Next service verifies AuthKit JWT signatures, issuer, client_id and expiry.
// Only this authenticated boundary may forward the signed principal; ownership
// comes from that immutable WorkOS subject, never email or a caller-supplied ID.
export async function verifiedActor(_ctx: Ctx, args: Actor) {
  service(args.secret);
  if (
    !validUser(args.subject) ||
    args.issuer !== authIssuer() ||
    !env.SCOPE_CLI_CLIENT_ID ||
    args.clientId !== env.SCOPE_CLI_CLIENT_ID ||
    !validSession(args.sessionId)
  )
    throw new Error("Unauthorized");
}
export async function clientActor(ctx: Ctx, args: Actor, allowStopped = false) {
  await verifiedActor(ctx, args);
  const row = await ctx.db
    .query("clientConnections")
    .withIndex("by_issuer_and_subject_and_clientId_and_sessionId", (q) =>
      q
        .eq("issuer", args.issuer)
        .eq("subject", args.subject)
        .eq("clientId", args.clientId)
        .eq("sessionId", args.sessionId),
    )
    .unique();
  if (
    !row ||
    row.ownerId !== args.subject ||
    (!allowStopped && row.stoppedAt !== undefined)
  )
    throw new Error("Connection unavailable");
  return row;
}
export function sameScopes(a: string[], b: string[]) {
  const left = canonicalScopes(a),
    right = canonicalScopes(b);
  return (
    left.length === right.length && left.every((scope, i) => scope === right[i])
  );
}

export function authorizationKey(
  providerId: string,
  userId: string,
  tenantId: string | undefined,
  connectorId: string,
) {
  return JSON.stringify([providerId, userId, tenantId ?? null, connectorId]);
}
