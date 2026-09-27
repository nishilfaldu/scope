import { env } from "../../_generated/server";
import { isPlainObject } from "../../lib/json";
import {
  envTrimmed,
  grantFromTokenPayload,
  oauthCallbackUrl,
  oauthErrorReason,
  refreshedFromPayload,
} from "../shared";
import { isGoogleApp, scopesForGoogleApp } from "../../domain/apps";
import type { ProviderOAuth } from "../types";

export const google: ProviderOAuth = {
  authorize(state, app) {
    if (!app || !isGoogleApp(app)) return { error: "Invalid Google app." };
    const clientId = envTrimmed(env.GOOGLE_CLIENT_ID);
    if (!clientId) {
      return { error: "Google OAuth is not configured." };
    }
    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl(app));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", scopesForGoogleApp(app));
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("access_type", "offline");
    authorize.searchParams.set("prompt", "consent select_account");
    authorize.searchParams.set("include_granted_scopes", "false");
    return { url: authorize.toString() };
  },

  async exchange(code, _state, app) {
    if (!app || !isGoogleApp(app)) return { error: "app" };
    const clientId = envTrimmed(env.GOOGLE_CLIENT_ID);
    const clientSecret = envTrimmed(env.GOOGLE_CLIENT_SECRET);
    if (!clientId || !clientSecret) {
      return { error: "config" };
    }
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: oauthCallbackUrl(app),
      }).toString(),
    });
    const tokenRaw: unknown = await tokenResponse.json();
    if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
      return { error: oauthErrorReason(tokenRaw) };
    }
    const userResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokenRaw.access_token}` } },
    );
    const userRaw: unknown = await userResponse.json();
    if (
      !userResponse.ok ||
      !isPlainObject(userRaw) ||
      typeof userRaw.id !== "string" ||
      !userRaw.id ||
      typeof userRaw.email !== "string" ||
      !userRaw.email
    )
      return { error: "identity" };
    return grantFromTokenPayload(tokenRaw, {
      login: userRaw.email,
      providerUserId: userRaw.id,
    });
  },

  /**
   * Always mint via refresh_token. Never return the vault standing access token.
   * Connections without offline refresh hard-fail.
   */
  async refresh(connection) {
    if (connection.refreshToken === null) {
      return null;
    }
    const clientId = envTrimmed(env.GOOGLE_CLIENT_ID);
    const clientSecret = envTrimmed(env.GOOGLE_CLIENT_SECRET);
    if (!clientId || !clientSecret) {
      return null;
    }
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: connection.refreshToken,
      }).toString(),
    });
    const tokenRaw: unknown = await tokenResponse.json();
    if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
      return null;
    }
    return refreshedFromPayload(tokenRaw, connection.refreshToken);
  },

  async revoke(accessToken) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken }).toString(),
    });
  },
};
