import {
  ConnectError,
  NoValidTokenError,
  UserAuthorizationRequiredError,
  ConnectorInstallationRequiredError,
  getConnectorMetadata,
  getTokenResponse,
  revokeToken,
  startAuthorization,
} from "@vercel/connect";
import { canonicalScopes as normalizeScopes } from "@/shared/contracts.mjs";
function canonicalScopes(scopes: unknown): string[] {
  try {
    return normalizeScopes(scopes);
  } catch {
    throw new ProviderFailure("grant-rejected");
  }
}
export type GrantReference = {
  providerId: string;
  connectorId: string;
  subjectId: string;
  issuer: string;
  installationId?: string;
  grantedScopes: string[];
  providerUserId?: string;
  providerTenantId?: string;
};
export class ProviderFailure extends Error {
  constructor(
    public readonly kind:
      | "reauthorization-required"
      | "configuration-invalid"
      | "retryable-unavailable"
      | "grant-rejected",
    public readonly authorizationAbsent = false,
  ) {
    super(kind);
  }
}
function failure(error: unknown): ProviderFailure {
  if (error instanceof ProviderFailure) return error;
  if (
    error instanceof NoValidTokenError ||
    error instanceof UserAuthorizationRequiredError ||
    error instanceof ConnectorInstallationRequiredError
  )
    return new ProviderFailure(
      "reauthorization-required",
      error instanceof UserAuthorizationRequiredError &&
        error.code === "user_authorization_required" &&
        (error.status === 400 || error.status === 404),
    );
  if (
    error instanceof ConnectError &&
    error.status !== undefined &&
    error.status < 500 &&
    error.status !== 429
  )
    return new ProviderFailure("configuration-invalid");
  return new ProviderFailure("retryable-unavailable");
}
function paramsFor(reference: GrantReference, completing = false) {
  if (
    reference.providerId !== "slack" ||
    !reference.subjectId ||
    !reference.issuer ||
    reference.installationId === "*" ||
    (!completing && !reference.installationId)
  )
    throw new ProviderFailure("grant-rejected");
  let scopes: string[];
  try {
    scopes = canonicalScopes(reference.grantedScopes);
  } catch {
    throw new ProviderFailure("grant-rejected");
  }
  return {
    subject: {
      type: "user" as const,
      id: reference.subjectId,
      issuer: reference.issuer,
    },
    // Connect records requested scopes; Slack adds identify to the effective user grant.
    scopes: scopes.filter((scope) => scope !== "identify"),
    ...(reference.installationId
      ? { installationId: reference.installationId }
      : {}),
  };
}
export async function configuredSlack(expectedConnectorId?: string) {
  try {
    const configured = process.env.SCOPE_SLACK_CONNECTOR;
    if (!configured) throw new ProviderFailure("configuration-invalid");
    const metadata = await getConnectorMetadata(configured);
    if (
      metadata.type !== "slack" ||
      metadata.service !== "slack" ||
      (expectedConnectorId && metadata.id !== expectedConnectorId) ||
      !Array.isArray(metadata.vendor.userScopes) ||
      !Array.isArray(metadata.vendor.botScopes) ||
      metadata.vendor.botScopes.length
    )
      throw new ProviderFailure("configuration-invalid");
    return {
      connectorId: metadata.id,
      // Slack includes identity access in user OAuth grants. Freeze and display it explicitly.
      scopes: canonicalScopes(["identify", ...metadata.vendor.userScopes]),
    };
  } catch (error) {
    throw failure(error);
  }
}
export async function beginAuthorization(
  reference: GrantReference,
  callbackUrl: string,
) {
  try {
    const result = await startAuthorization(
      reference.connectorId,
      paramsFor(reference, true),
      { callbackUrl, expiresInMs: 600_000 },
    );
    if (new URL(result.url).protocol !== "https:")
      throw new ProviderFailure("configuration-invalid");
    return { url: result.url };
  } catch (error) {
    throw failure(error);
  }
}
async function slackResponse(method: "auth.test", token: string) {
  const response = await fetch("https://slack.com/api/" + method, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429 || response.status >= 500)
    throw new ProviderFailure("retryable-unavailable");
  if (!response.ok) throw new ProviderFailure("grant-rejected");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ProviderFailure("grant-rejected");
  return { body: body as Record<string, unknown>, headers: response.headers };
}
function invalidToken(body: Record<string, unknown>) {
  return (
    body.ok === false &&
    ["invalid_auth", "token_revoked"].includes(String(body.error))
  );
}
async function freshGrant(reference: GrantReference, completing = false) {
  const grant = await getTokenResponse(
    reference.connectorId,
    paramsFor(reference, completing),
    { forceRefresh: true },
  );
  if (
    grant.connector.id !== reference.connectorId ||
    grant.connector.type !== "slack" ||
    !(
      grant.token?.startsWith("xoxp-") || grant.token?.startsWith("xoxe.xoxp-")
    ) ||
    !grant.installationId ||
    grant.installationId === "*" ||
    (reference.installationId &&
      reference.installationId !== grant.installationId)
  )
    throw new ProviderFailure("grant-rejected");
  return grant;
}
function verifyIdentity(
  reference: GrantReference,
  body: Record<string, unknown>,
) {
  if (
    body.ok !== true ||
    body.bot_id ||
    typeof body.user_id !== "string" ||
    !body.user_id ||
    typeof body.team_id !== "string" ||
    !body.team_id ||
    (reference.providerUserId && reference.providerUserId !== body.user_id) ||
    (reference.providerTenantId && reference.providerTenantId !== body.team_id)
  )
    throw new ProviderFailure("grant-rejected");
  return { providerUserId: body.user_id, providerTenantId: body.team_id };
}
export async function acquireVerifiedCredential(
  reference: GrantReference,
  completing = false,
  inspectOnly = false,
) {
  try {
    const grant = await freshGrant(reference, completing),
      { body, headers } = await slackResponse("auth.test", grant.token);
    if (invalidToken(body))
      throw new ProviderFailure("reauthorization-required");
    const identity = verifyIdentity(reference, body);
    if (
      (grant.tenantId && grant.tenantId !== identity.providerTenantId) ||
      (grant.externalSubject &&
        grant.externalSubject !== identity.providerUserId)
    )
      throw new ProviderFailure("grant-rejected");
    let grantedScopes: string[];
    try {
      grantedScopes = canonicalScopes(
        (headers.get("x-oauth-scopes") ?? "").split(/[,\s]+/).filter(Boolean),
      );
    } catch {
      throw new ProviderFailure("grant-rejected");
    }
    if (
      !inspectOnly &&
      JSON.stringify(grantedScopes) !==
        JSON.stringify(canonicalScopes(reference.grantedScopes))
    ) {
      throw new ProviderFailure("grant-rejected");
    }
    return {
      accessToken: grant.token,
      ...identity,
      installationId: grant.installationId,
      ...(grant.tokenId ? { tokenId: grant.tokenId } : {}),
      label: `${typeof body.user === "string" ? body.user : identity.providerUserId} (${typeof body.team === "string" ? body.team : identity.providerTenantId})`,
      grantedScopes,
    };
  } catch (error) {
    throw failure(error);
  }
}
export async function disconnect(reference: GrantReference) {
  try {
    await revokeToken(reference.connectorId, {
      subject: paramsFor(reference).subject,
      installationId: reference.installationId,
    });
    return { outcome: "succeeded" as const };
  } catch (error) {
    // The exact user subject has no authorization left. Generic 404s can mean
    // missing connectors/configuration, and no_token can mean a provider outage.
    if (
      error instanceof UserAuthorizationRequiredError &&
      error.code === "user_authorization_required" &&
      (error.status === 400 || error.status === 404)
    )
      return { outcome: "succeeded" as const };
    return { outcome: "failed" as const, code: failure(error).kind };
  }
}

// Setup inspection records the actual grant before deciding whether it is safe to activate.
export async function inspectConnection(reference: GrantReference) {
  const grant = await acquireVerifiedCredential(reference, true, true);
  if (!grant.installationId) throw new ProviderFailure("grant-rejected");
  return { ...grant, installationId: grant.installationId };
}
