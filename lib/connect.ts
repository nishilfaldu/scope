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
import { canonicalScopes } from "@/shared/contracts.mjs";
import { ProviderFailure } from "./connect-error";
import { connectorCatalog } from "./connector-catalog";
import { inspectSlackSetup } from "./connectors/slack-setup";

export type ConnectTarget = {
  connectorId: string;
  subjectId: string;
  issuer: string;
  installationId?: string;
};
export type CredentialReference = ConnectTarget & { scopes: string[] };
export type SetupReference = CredentialReference & {
  providerId: string;
  providerName: string;
};
export { ProviderFailure } from "./connect-error";
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
function subject(reference: ConnectTarget) {
  if (
    !reference.connectorId ||
    !reference.subjectId ||
    !reference.issuer ||
    reference.installationId === "*"
  )
    throw new ProviderFailure("grant-rejected");
  return {
    type: "user" as const,
    id: reference.subjectId,
    issuer: reference.issuer,
  };
}
function paramsFor(reference: CredentialReference) {
  let scopes: string[];
  try {
    scopes = canonicalScopes(reference.scopes);
  } catch {
    throw new ProviderFailure("grant-rejected");
  }
  if (scopes.includes("*")) throw new ProviderFailure("grant-rejected");
  return {
    subject: subject(reference),
    scopes,
    ...(reference.installationId
      ? { installationId: reference.installationId }
      : {}),
  };
}
export async function configuredConnector(providerId: string) {
  const entry = connectorCatalog.find((item) => item.providerId === providerId);
  if (!entry) throw new ProviderFailure("configuration-invalid");
  try {
    const configured = process.env[entry.connectorEnv];
    if (!configured) throw new ProviderFailure("configuration-invalid");
    const metadata = await getConnectorMetadata(configured);
    if (
      metadata.service !== entry.service ||
      !metadata.id ||
      (entry.scopeField && !Array.isArray(metadata.vendor[entry.scopeField])) ||
      (entry.excludedScopeField &&
        (!Array.isArray(metadata.vendor[entry.excludedScopeField]) ||
          (metadata.vendor[entry.excludedScopeField] as unknown[]).length))
    )
      throw new ProviderFailure("configuration-invalid");
    let scopes: string[];
    try {
      scopes = entry.scopeField
        ? canonicalScopes(metadata.vendor[entry.scopeField])
        : [];
    } catch {
      throw new ProviderFailure("configuration-invalid");
    }
    if (scopes.includes("*"))
      throw new ProviderFailure("configuration-invalid");
    return {
      providerId: entry.providerId,
      provider: entry.provider,
      connectorId: metadata.id,
      scopes,
    };
  } catch (error) {
    throw failure(error);
  }
}
export async function availableConnectors() {
  return Promise.all(
    connectorCatalog.map(async (entry) => {
      try {
        await configuredConnector(entry.providerId);
        return {
          providerId: entry.providerId,
          provider: entry.provider,
          available: true,
        };
      } catch {
        return {
          providerId: entry.providerId,
          provider: entry.provider,
          available: false,
        };
      }
    }),
  );
}
export async function beginAuthorization(
  reference: CredentialReference,
  callbackUrl: string,
) {
  try {
    const result = await startAuthorization(
      reference.connectorId,
      paramsFor(reference),
      { callbackUrl, expiresInMs: 600_000 },
    );
    if (new URL(result.url).protocol !== "https:")
      throw new ProviderFailure("configuration-invalid");
    return { url: result.url };
  } catch (error) {
    throw failure(error);
  }
}
async function grantFor(reference: CredentialReference) {
  const grant = await getTokenResponse(
    reference.connectorId,
    paramsFor(reference),
    { forceRefresh: true },
  );
  if (
    grant.connector.id !== reference.connectorId ||
    !grant.token ||
    grant.installationId === "*" ||
    (reference.installationId &&
      reference.installationId !== grant.installationId)
  )
    throw new ProviderFailure("grant-rejected");
  return grant;
}
export async function acquireCredential(reference: CredentialReference) {
  try {
    const grant = await grantFor(reference);
    if (grant.installationId !== reference.installationId)
      throw new ProviderFailure("grant-rejected");
    return { accessToken: grant.token };
  } catch (error) {
    throw failure(error);
  }
}
// Provider inspection is confined to setup where identity is needed for safe cleanup.
export async function inspectConnection(reference: SetupReference) {
  try {
    const grant = await grantFor(reference);
    if (reference.providerId === "slack") {
      if (!grant.installationId) throw new ProviderFailure("grant-rejected");
      return {
        ...(await inspectSlackSetup(grant)),
        installationId: grant.installationId,
      };
    }
    // A usable identity is required by duplicate-grant protection, not just a label.
    if (!grant.externalSubject)
      throw new ProviderFailure("configuration-invalid");
    return {
      providerUserId: grant.externalSubject,
      providerTenantId: grant.tenantId,
      installationId: grant.installationId,
      label: grant.name?.trim() || `${reference.providerName} account`,
      grantedScopes: [],
    };
  } catch (error) {
    throw failure(error);
  }
}
export async function disconnect(reference: ConnectTarget) {
  try {
    await revokeToken(reference.connectorId, {
      subject: subject(reference),
      ...(reference.installationId
        ? { installationId: reference.installationId }
        : {}),
    });
    return { outcome: "succeeded" as const };
  } catch (error) {
    if (
      error instanceof UserAuthorizationRequiredError &&
      error.code === "user_authorization_required" &&
      (error.status === 400 || error.status === 404)
    )
      return { outcome: "succeeded" as const };
    return { outcome: "failed" as const, code: failure(error).kind };
  }
}
