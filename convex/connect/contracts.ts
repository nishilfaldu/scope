import { v } from "convex/values";

export const CONNECT_SLACK_SCOPES = [
  "channels:history",
  "channels:read",
  "chat:write",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "pins:read",
  "pins:write",
  "reactions:read",
  "reactions:write",
  "users:read",
];

export const connectReferenceValidator = v.object({
  subjectId: v.string(),
  issuer: v.string(),
  connectorId: v.string(),
  installationId: v.string(),
});
export const bridgeCommandValidator = v.union(
  v.object({
    operation: v.literal("authorize"),
    subjectId: v.string(),
    issuer: v.string(),
    state: v.string(),
  }),
  v.object({
    operation: v.literal("token"),
    subjectId: v.string(),
    issuer: v.string(),
    connectorId: v.optional(v.string()),
    installationId: v.optional(v.string()),
    providerUserId: v.optional(v.string()),
  }),
  v.object({
    operation: v.literal("revoke"),
    reference: connectReferenceValidator,
  }),
);

export function isRotatingSlackUserToken(token: unknown): token is string {
  return typeof token === "string" && /^xoxe\.xoxp-/.test(token);
}
export function slackScopesAreBounded(scopes: unknown): scopes is string[] {
  return (
    Array.isArray(scopes) &&
    scopes.length > 0 &&
    scopes.every(
      (scope) =>
        typeof scope === "string" &&
        (scope === "identify" || CONNECT_SLACK_SCOPES.includes(scope)),
    )
  );
}
export function slackExpiryIsBounded(expiresAt: unknown): expiresAt is number {
  return (
    typeof expiresAt === "number" &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + 30_000 &&
    expiresAt <= Date.now() + 12 * 60 * 60_000 + 60_000
  );
}
