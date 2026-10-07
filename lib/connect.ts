import {
  ConnectError,
  ConnectorInstallationRequiredError,
  getTokenResponse,
  NoValidTokenError,
  revokeToken,
  startAuthorization,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { connectorFor, connectors } from "@/shared/connectors";

export type FailureCode =
  "reconnect-required" | "provider-unavailable" | "configuration-invalid";

export class ProviderFailure extends Error {
  constructor(public readonly code: FailureCode) {
    super(code);
  }
}

function failure(error: unknown) {
  if (error instanceof ProviderFailure) return error;
  if (
    error instanceof NoValidTokenError ||
    error instanceof UserAuthorizationRequiredError ||
    error instanceof ConnectorInstallationRequiredError
  )
    return new ProviderFailure("reconnect-required");
  if (
    error instanceof ConnectError &&
    error.status !== undefined &&
    error.status < 500 &&
    error.status !== 429
  )
    return new ProviderFailure("configuration-invalid");
  return new ProviderFailure("provider-unavailable");
}

// The person is the Connect subject, so no client can name another person's grant.
function subjectFor(ownerId: string) {
  return {
    type: "user" as const,
    id: ownerId,
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
  };
}

function connectorIdFor(providerId: string) {
  const entry = connectorFor(providerId),
    connectorId = entry && process.env[entry.connectorEnv];
  if (!entry || !connectorId)
    throw new ProviderFailure("configuration-invalid");
  return { connectorId, scopes: entry.scopes };
}

export function availableProviders() {
  return connectors.map((entry) => ({
    providerId: entry.providerId,
    provider: entry.provider,
    available: Boolean(process.env[entry.connectorEnv]),
  }));
}

export async function authorizationUrl(
  ownerId: string,
  providerId: string,
  callbackUrl: string,
) {
  const { connectorId, scopes } = connectorIdFor(providerId);
  try {
    const { url } = await startAuthorization(
      connectorId,
      { subject: subjectFor(ownerId), ...(scopes && { scopes: [...scopes] }) },
      { callbackUrl, expiresInMs: 600_000 },
    );
    if (new URL(url).protocol !== "https:")
      throw new ProviderFailure("configuration-invalid");
    return url;
  } catch (error) {
    throw failure(error);
  }
}

// Each reader asks the provider which scopes the token carries.
const scopeReaders: Record<string, (token: string) => Promise<string[]>> = {
  async slack(token) {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    const header = response.headers.get("x-oauth-scopes");
    if (!response.ok || body.ok !== true || header === null)
      throw new Error("Slack did not report scopes");
    return header
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
  },
};

export async function readGrant(ownerId: string, providerId: string) {
  const { connectorId, scopes } = connectorIdFor(providerId);
  try {
    const grant = await getTokenResponse(
      connectorId,
      { subject: subjectFor(ownerId), ...(scopes && { scopes: [...scopes] }) },
      { forceRefresh: true },
    );
    // The connection still succeeds when the provider reports nothing.
    const grantedScopes = await scopeReaders[providerId]?.(grant.token).catch(
      () => undefined,
    );
    return {
      connectorId,
      installationId: grant.installationId,
      label:
        grant.name?.trim() || `${connectorFor(providerId)!.provider} account`,
      ...(grantedScopes && { grantedScopes }),
    };
  } catch (error) {
    throw failure(error);
  }
}

export async function tokenFor(account: {
  ownerId: string;
  providerId: string;
  connectorId: string;
  installationId?: string;
}) {
  const scopes = connectorFor(account.providerId)?.scopes;
  try {
    const grant = await getTokenResponse(account.connectorId, {
      subject: subjectFor(account.ownerId),
      ...(scopes && { scopes: [...scopes] }),
      ...(account.installationId && { installationId: account.installationId }),
    });
    if (!grant.token || grant.installationId !== account.installationId)
      throw new ProviderFailure("reconnect-required");
    return grant.token;
  } catch (error) {
    throw failure(error);
  }
}

export async function revoke(account: {
  ownerId: string;
  connectorId: string;
  installationId?: string;
}) {
  try {
    await revokeToken(account.connectorId, {
      subject: subjectFor(account.ownerId),
      ...(account.installationId && { installationId: account.installationId }),
    });
  } catch (error) {
    // Connect reports a grant that is already gone this way.
    if (
      error instanceof UserAuthorizationRequiredError &&
      (error.status === 400 || error.status === 404)
    )
      return;
    throw failure(error);
  }
}
