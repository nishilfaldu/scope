import {
  ConnectorInstallationRequiredError,
  ConnectError,
  NoValidTokenError,
  UserAuthorizationRequiredError,
  getConnectorMetadata,
  getTokenResponse,
  revokeToken,
  startAuthorization,
  type ConnectTokenParams,
} from "@vercel/connect";

// Enable only after the integration's live OAuth acceptance checks are recorded.
export const integrations = [
  {
    id: "airtable-rest-read",
    provider: "Airtable",
    connectorEnv: "SCOPE_AIRTABLE_REST_CONNECTOR",
    service: "airtable",
    type: "oauth",
    apiOrigin: "https://api.airtable.com",
    installationRequired: false,
    profileId: "bases.read",
    profileVersion: 1,
    scopes: ["schema.bases:read"],
    accessDescription: "Read the bases granted during Airtable sign-in.",
    revocationNote: "Previously received access may remain active at Airtable.",
    enabled: false,
  },
  {
    id: "slack-read",
    provider: "Slack",
    connectorEnv: "SCOPE_SLACK_CONNECTOR",
    service: "slack",
    type: "slack",
    apiOrigin: "https://slack.com",
    installationRequired: true,
    profileId: "channels.read",
    profileVersion: 1,
    scopes: ["channels:read"],
    accessDescription: "Read public channels in this Slack workspace.",
    revocationNote: "Previously received access may remain active at Slack.",
    enabled: false,
  },
] as const;
export type Integration = (typeof integrations)[number];
export type GrantReference = {
  integrationId: string;
  connectorId: string;
  subjectId: string;
  issuer: string;
  installationId?: string;
  profileId: string;
  profileVersion: number;
  providerUserId?: string;
  providerTenantId?: string;
};
export type ProviderFailureKind =
  | "reauthorization-required"
  | "configuration-invalid"
  | "retryable-unavailable"
  | "grant-rejected";
export class ProviderFailure extends Error {
  constructor(public readonly kind: ProviderFailureKind) {
    super(kind);
  }
}
export function integrationFor(id: string) {
  const integration = integrations.find((item) => item.id === id);
  if (!integration) throw new ProviderFailure("configuration-invalid");
  return integration;
}
export function requireEnabledIntegration(id: string) {
  const integration = integrationFor(id);
  if (!integration.enabled) throw new ProviderFailure("configuration-invalid");
  return integration;
}
function connectorFor(integration: Integration) {
  const connector = process.env[integration.connectorEnv];
  if (!connector) throw new ProviderFailure("configuration-invalid");
  return connector;
}
function failure(error: unknown): ProviderFailure {
  if (error instanceof ProviderFailure) return error;
  if (
    error instanceof NoValidTokenError ||
    error instanceof UserAuthorizationRequiredError ||
    error instanceof ConnectorInstallationRequiredError
  )
    return new ProviderFailure("reauthorization-required");
  if (error instanceof ConnectError) {
    if (
      [
        "no_token",
        "user_authorization_required",
        "installation_required",
      ].includes(error.code ?? "")
    )
      return new ProviderFailure("reauthorization-required");
    if (
      error.status === 429 ||
      (error.status !== undefined && error.status >= 500)
    )
      return new ProviderFailure("retryable-unavailable");
    return new ProviderFailure("configuration-invalid");
  }
  return new ProviderFailure("retryable-unavailable");
}
async function metadataFor(
  integration: Integration,
  expectedConnectorId?: string,
) {
  const metadata = await getConnectorMetadata(connectorFor(integration));
  if (
    metadata.type !== integration.type ||
    metadata.service !== integration.service ||
    (expectedConnectorId && metadata.id !== expectedConnectorId)
  )
    throw new ProviderFailure("configuration-invalid");
  // OAuth credentials configured for an upstream MCP resource cannot silently
  // become REST credentials. Never return the remaining vendor configuration.
  const serverUrl = metadata.vendor.serverUrl;
  if (serverUrl !== undefined) {
    try {
      if (
        typeof serverUrl !== "string" ||
        new URL(serverUrl).origin !== integration.apiOrigin
      )
        throw new Error("Invalid resource");
    } catch {
      throw new ProviderFailure("configuration-invalid");
    }
  }
  return metadata.id;
}
function paramsFor(
  integration: Integration,
  reference: GrantReference,
  completingAuthorization = false,
): ConnectTokenParams {
  if (
    !reference.subjectId ||
    !reference.issuer ||
    reference.installationId === "*" ||
    reference.profileId !== integration.profileId ||
    reference.profileVersion !== integration.profileVersion ||
    (integration.installationRequired &&
      !completingAuthorization &&
      !reference.installationId)
  )
    throw new ProviderFailure("grant-rejected");
  return {
    subject: {
      type: "user",
      id: reference.subjectId,
      issuer: reference.issuer,
    },
    ...(reference.installationId
      ? { installationId: reference.installationId }
      : {}),
    scopes: [...integration.scopes],
  };
}
export async function beginAuthorization(
  reference: GrantReference,
  callbackUrl: string,
) {
  try {
    const integration = integrationFor(reference.integrationId);
    await metadataFor(integration, reference.connectorId);
    // An installed provider obtains its first installation during authorization.
    const params: ConnectTokenParams = {
      subject: {
        type: "user",
        id: reference.subjectId,
        issuer: reference.issuer,
      },
      scopes: [...integration.scopes],
    };
    const result = await startAuthorization(reference.connectorId, params, {
      callbackUrl,
      expiresInMs: 600_000,
    });
    if (new URL(result.url).protocol !== "https:")
      throw new ProviderFailure("configuration-invalid");
    return { url: result.url };
  } catch (error) {
    throw failure(error);
  }
}
// Resolve configured connector metadata before creating an authorization attempt.
export async function configuredIntegration(id: string) {
  try {
    const integration = integrationFor(id);
    return { integration, connectorId: await metadataFor(integration) };
  } catch (error) {
    throw failure(error);
  }
}
async function providerResponse(url: string, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401)
    throw new ProviderFailure("reauthorization-required");
  if (response.status === 429 || response.status >= 500)
    throw new ProviderFailure("retryable-unavailable");
  if (!response.ok) throw new ProviderFailure("grant-rejected");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ProviderFailure("grant-rejected");
  return { body: body as Record<string, unknown>, headers: response.headers };
}
function validateScopes(integration: Integration, scopes: unknown) {
  if (
    !Array.isArray(scopes) ||
    scopes.some((scope) => typeof scope !== "string")
  )
    throw new ProviderFailure("grant-rejected");
  if (
    integration.scopes.some((scope) => !scopes.includes(scope)) ||
    scopes.some(
      (scope) => !(integration.scopes as readonly string[]).includes(scope),
    )
  )
    throw new ProviderFailure("grant-rejected");
  return scopes as string[];
}
export async function acquireVerifiedCredential(
  reference: GrantReference,
  completingAuthorization = false,
) {
  try {
    const integration = integrationFor(reference.integrationId);
    await metadataFor(integration, reference.connectorId);
    const params = paramsFor(integration, reference, completingAuthorization);
    const grant = await getTokenResponse(reference.connectorId, params, {
      forceRefresh: true,
    });
    if (
      grant.connector.id !== reference.connectorId ||
      grant.connector.type !== integration.type ||
      !grant.token ||
      !Number.isFinite(grant.expiresAt) ||
      grant.expiresAt <= Date.now() + 30_000 ||
      grant.installationId === "*" ||
      (integration.installationRequired && !grant.installationId) ||
      (reference.installationId &&
        grant.installationId !== reference.installationId)
    )
      throw new ProviderFailure("grant-rejected");
    let providerUserId: string,
      providerTenantId: string | undefined,
      providerEmail: string | undefined,
      label: string,
      grantedScopes: string[];
    if (integration.provider === "Airtable") {
      const { body } = await providerResponse(
        integration.apiOrigin + "/v0/meta/whoami",
        grant.token,
      );
      if (typeof body.id !== "string" || !body.id)
        throw new ProviderFailure("grant-rejected");
      providerUserId = body.id;
      providerEmail = typeof body.email === "string" ? body.email : undefined;
      grantedScopes = validateScopes(integration, body.scopes);
      label = providerEmail || "Airtable account";
    } else {
      if (
        !grant.token.startsWith("xoxe.xoxp-") ||
        grant.expiresAt > Date.now() + 12 * 60 * 60_000 + 60_000
      )
        throw new ProviderFailure("grant-rejected");
      const { body, headers } = await providerResponse(
        integration.apiOrigin + "/api/auth.test",
        grant.token,
      );
      if (
        body.ok !== true ||
        body.bot_id ||
        typeof body.user_id !== "string" ||
        !body.user_id ||
        typeof body.team_id !== "string" ||
        !body.team_id
      )
        throw new ProviderFailure("grant-rejected");
      providerUserId = body.user_id;
      providerTenantId = body.team_id;
      if (
        (grant.tenantId && grant.tenantId !== providerTenantId) ||
        (grant.externalSubject && grant.externalSubject !== providerUserId)
      )
        throw new ProviderFailure("grant-rejected");
      grantedScopes = validateScopes(
        integration,
        (headers.get("x-oauth-scopes") ?? "").split(/[,\s]+/).filter(Boolean),
      );
      label = `${typeof body.user === "string" ? body.user : providerUserId} (${typeof body.team === "string" ? body.team : providerTenantId})`;
    }
    if (
      (reference.providerUserId &&
        providerUserId !== reference.providerUserId) ||
      (reference.providerTenantId &&
        providerTenantId !== reference.providerTenantId)
    )
      throw new ProviderFailure("grant-rejected");
    return {
      accessToken: grant.token,
      providerExpiresAt: grant.expiresAt,
      ...(grant.tokenId ? { tokenId: grant.tokenId } : {}),
      ...(grant.installationId ? { installationId: grant.installationId } : {}),
      providerUserId,
      ...(providerTenantId ? { providerTenantId } : {}),
      ...(providerEmail ? { providerEmail } : {}),
      label,
      grantedScopes,
    };
  } catch (error) {
    throw failure(error);
  }
}
export async function disconnect(reference: GrantReference) {
  try {
    const integration = integrationFor(reference.integrationId);
    await metadataFor(integration, reference.connectorId);
    await revokeToken(reference.connectorId, {
      subject: paramsFor(integration, reference).subject,
      ...(reference.installationId
        ? { installationId: reference.installationId }
        : {}),
    });
    // Connect success is not evidence that previously released bearers were recalled.
    return { outcome: "succeeded" as const };
  } catch {
    return { outcome: "failed" as const };
  }
}
