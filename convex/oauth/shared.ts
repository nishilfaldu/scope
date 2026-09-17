import { env } from "../_generated/server";
import { asFiniteNumber, isPlainObject } from "../lib/json";
import type { AppId, ProviderId } from "../domain/apps";
import type { OAuthGrant, RefreshedTokens } from "./types";

export const REFRESH_SKEW_MS = 2 * 60 * 1000;

/** Missing/empty env (vitest/CI) must never throw on .trim(). */
export function envTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function envConfigured(value: unknown): boolean {
  return envTrimmed(value) !== undefined;
}

export function oauthErrorReason(raw: unknown): string {
  if (isPlainObject(raw) && typeof raw.error === "string") {
    const error = raw.error.slice(0, 80);
    if (/^[a-z0-9_]+$/i.test(error)) {
      return error;
    }
  }
  return "token";
}

export function oauthCallbackUrl(provider: ProviderId | AppId): string {
  return `${env.CONVEX_SITE_URL.replace(/\/$/, "")}/api/${provider}/callback`;
}

export function grantFromTokenPayload(
  tokenRaw: Record<string, unknown>,
  identity: { login: string; providerUserId: string },
): OAuthGrant {
  const expiresIn = asFiniteNumber(tokenRaw.expires_in);
  return {
    accessToken: String(tokenRaw.access_token),
    refreshToken:
      typeof tokenRaw.refresh_token === "string"
        ? tokenRaw.refresh_token
        : undefined,
    tokenExpiresAt:
      expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
    login: identity.login,
    providerUserId: identity.providerUserId,
  };
}

export function refreshedFromPayload(
  tokenRaw: Record<string, unknown>,
  fallbackRefresh: string | null,
): RefreshedTokens {
  const expiresIn = asFiniteNumber(tokenRaw.expires_in);
  return {
    accessToken: String(tokenRaw.access_token),
    refreshToken:
      typeof tokenRaw.refresh_token === "string"
        ? tokenRaw.refresh_token
        : fallbackRefresh ?? undefined,
    tokenExpiresAt:
      expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
  };
}
