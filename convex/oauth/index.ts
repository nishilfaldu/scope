import { env } from "../_generated/server";
import type { ProviderId } from "../permissions";
import { PROVIDER_OAUTH } from "./providers";
import type {
  AuthorizeStart,
  ConnectionSecrets,
  OAuthGrant,
  RefreshedTokens,
} from "./types";

export type { ConnectionSecrets, OAuthGrant, RefreshedTokens };

/** Missing/empty env (e.g. vitest/CI) counts as not configured — never throw. */
function envConfigured(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function oauthConfigured(): Record<ProviderId, boolean> {
  return {
    github:
      envConfigured(env.GITHUB_CLIENT_ID) &&
      envConfigured(env.GITHUB_CLIENT_SECRET),
    google:
      envConfigured(env.GOOGLE_CLIENT_ID) &&
      envConfigured(env.GOOGLE_CLIENT_SECRET),
    slack:
      envConfigured(env.SLACK_CLIENT_ID) &&
      envConfigured(env.SLACK_CLIENT_SECRET),
  };
}

export function startAuthorize(
  provider: ProviderId,
  state: string,
): AuthorizeStart {
  return PROVIDER_OAUTH[provider].authorize(state);
}

export async function exchangeAuthorizationCode(
  provider: ProviderId,
  code: string,
): Promise<OAuthGrant | { error: string }> {
  return await PROVIDER_OAUTH[provider].exchange(code);
}

export async function refreshProviderTokens(
  provider: ProviderId,
  connection: ConnectionSecrets,
): Promise<RefreshedTokens | null> {
  return await PROVIDER_OAUTH[provider].refresh(connection);
}

export async function revokeProviderGrant(
  provider: ProviderId,
  accessToken: string,
): Promise<void> {
  await PROVIDER_OAUTH[provider].revoke(accessToken);
}
