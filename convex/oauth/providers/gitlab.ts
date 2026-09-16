import { env } from "../../_generated/server";
import { asFiniteNumber, isPlainObject } from "../../lib/json";
import {
  envTrimmed,
  grantFromTokenPayload,
  oauthCallbackUrl,
  oauthErrorReason,
  refreshedFromPayload,
} from "../shared";
import type { ProviderOAuth } from "../types";

/**
 * GitLab.com OAuth scopes.
 * `api` grants full API access for agent work; `read_user` ensures identity.
 * Self-managed GitLab instances are out of scope for this connection (gitlab.com only).
 * Access tokens expire (~2h); refresh tokens are required for short-lived mint.
 */
const GITLAB_OAUTH_SCOPES = "api read_user";

const AUTHORIZE_URL = "https://gitlab.com/oauth/authorize";
const TOKEN_URL = "https://gitlab.com/oauth/token";
const REVOKE_URL = "https://gitlab.com/oauth/revoke";
const USER_URL = "https://gitlab.com/api/v4/user";

function credentials() {
  const clientId = envTrimmed(env.GITLAB_CLIENT_ID);
  const clientSecret = envTrimmed(env.GITLAB_CLIENT_SECRET);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function tokenRequest(body: Record<string, string>) {
  const client = credentials();
  if (!client) return { error: "config" } as const;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }).toString(),
  });
  const raw: unknown = await response.json();
  if (!isPlainObject(raw) || typeof raw.access_token !== "string") {
    return { error: oauthErrorReason(raw) } as const;
  }
  return raw;
}

async function identity(accessToken: string) {
  const response = await fetch(USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const raw: unknown = await response.json();
  const value = isPlainObject(raw) ? raw : {};
  const login =
    (typeof value.username === "string" && value.username) ||
    (typeof value.email === "string" && value.email) ||
    (typeof value.name === "string" && value.name) ||
    "gitlab";
  const providerUserId =
    asFiniteNumber(value.id) !== null
      ? String(asFiniteNumber(value.id))
      : login;
  return { login, providerUserId };
}

export const gitlab: ProviderOAuth = {
  authorize(state) {
    const client = credentials();
    if (!client) {
      return { error: "GitLab OAuth is not configured." };
    }
    const authorize = new URL(AUTHORIZE_URL);
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("gitlab"));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", GITLAB_OAUTH_SCOPES);
    authorize.searchParams.set("state", state);
    return { url: authorize.toString() };
  },

  async exchange(code) {
    const raw = await tokenRequest({
      code,
      grant_type: "authorization_code",
      redirect_uri: oauthCallbackUrl("gitlab"),
    });
    if ("error" in raw) return { error: String(raw.error) };
    return grantFromTokenPayload(raw, await identity(String(raw.access_token)));
  },

  /**
   * Always mint via refresh_token. Never return the vault standing access token.
   * Connections without a refresh token hard-fail (SHORT_LIVED_UNAVAILABLE upstream).
   */
  async refresh(connection) {
    if (connection.refreshToken === null) {
      return null;
    }
    const raw = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
      redirect_uri: oauthCallbackUrl("gitlab"),
    });
    if ("error" in raw) return null;
    return refreshedFromPayload(raw, connection.refreshToken);
  },

  async revoke(accessToken) {
    const client = credentials();
    if (!client) return;
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        token: accessToken,
      }).toString(),
    });
  },
};
