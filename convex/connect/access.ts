import {
  isRotatingSlackUserToken,
  slackScopesAreBounded,
  slackExpiryIsBounded,
} from "./contracts";

export function verifiedGrant(raw: Record<string, unknown>) {
  if (
    !isRotatingSlackUserToken(raw.accessToken) ||
    !slackExpiryIsBounded(raw.expiresAt) ||
    typeof raw.providerUserId !== "string" ||
    !/^[^:]+:[^:]+$/.test(raw.providerUserId) ||
    typeof raw.login !== "string" ||
    typeof raw.connectorId !== "string" ||
    !raw.connectorId ||
    typeof raw.installationId !== "string" ||
    !raw.installationId ||
    raw.installationId === "*" ||
    !slackScopesAreBounded(raw.grantedScopes)
  )
    throw new Error("Invalid Slack Connect grant");
  return {
    accessToken: raw.accessToken,
    expiresAt: raw.expiresAt,
    providerUserId: raw.providerUserId,
    login: raw.login,
    connectorId: raw.connectorId,
    installationId: raw.installationId,
    grantedScopes: raw.grantedScopes,
  };
}
