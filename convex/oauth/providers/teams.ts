import { env } from "../../_generated/server";
import { isPlainObject } from "../../lib/json";
import {
  envTrimmed,
  grantFromTokenPayload,
  oauthCallbackUrl,
  oauthErrorReason,
  refreshedFromPayload,
} from "../shared";
import type { ProviderOAuth } from "../types";

/**
 * Microsoft identity platform (Entra ID) scopes for Teams via Microsoft Graph.
 * offline_access is required so agents can mint short-lived access tokens.
 */
const TEAMS_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Chat.ReadWrite",
  "Channel.ReadBasic.All",
  "Team.ReadBasic.All",
  "ChannelMessage.Send",
].join(" ");

const AUTHORIZE_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

function credentials() {
  const clientId = envTrimmed(env.TEAMS_CLIENT_ID);
  const clientSecret = envTrimmed(env.TEAMS_CLIENT_SECRET);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const teams: ProviderOAuth = {
  authorize(state) {
    const client = credentials();
    if (!client) {
      return { error: "Microsoft Teams OAuth is not configured." };
    }
    const authorize = new URL(AUTHORIZE_URL);
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("teams"));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("response_mode", "query");
    authorize.searchParams.set("scope", TEAMS_OAUTH_SCOPES);
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("prompt", "consent");
    return { url: authorize.toString() };
  },

  async exchange(code) {
    const client = credentials();
    if (!client) {
      return { error: "config" };
    }
    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: oauthCallbackUrl("teams"),
        scope: TEAMS_OAUTH_SCOPES,
      }).toString(),
    });
    const tokenRaw: unknown = await tokenResponse.json();
    if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
      return { error: oauthErrorReason(tokenRaw) };
    }
    const userResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenRaw.access_token}` },
    });
    const userRaw: unknown = await userResponse.json();
    const value = isPlainObject(userRaw) ? userRaw : {};
    const login =
      (typeof value.mail === "string" && value.mail) ||
      (typeof value.userPrincipalName === "string" &&
        value.userPrincipalName) ||
      (typeof value.displayName === "string" && value.displayName) ||
      "teams";
    const providerUserId = typeof value.id === "string" ? value.id : login;
    return grantFromTokenPayload(tokenRaw, { login, providerUserId });
  },

  /**
   * Always mint via refresh_token. Never return the vault standing access token.
   * Connections without offline_access refresh hard-fail.
   */
  async refresh(connection) {
    if (connection.refreshToken === null) {
      return null;
    }
    const client = credentials();
    if (!client) {
      return null;
    }
    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "refresh_token",
        refresh_token: connection.refreshToken,
        scope: TEAMS_OAUTH_SCOPES,
      }).toString(),
    });
    const tokenRaw: unknown = await tokenResponse.json();
    if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
      return null;
    }
    return refreshedFromPayload(tokenRaw, connection.refreshToken);
  },

  async revoke() {
    // Microsoft identity platform has no single-token revoke for delegated
    // Graph grants; users remove consent in Microsoft account / Entra settings.
  },
};
