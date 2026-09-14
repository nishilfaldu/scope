import { env } from "../../_generated/server";
import { isPlainObject } from "../../json";
import {
  grantFromTokenPayload,
  oauthCallbackUrl,
  oauthErrorReason,
  refreshedFromPayload,
} from "../shared";
import type { ProviderOAuth } from "../types";

const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

export const google: ProviderOAuth = {
  authorize(state) {
    const clientId = env.GOOGLE_CLIENT_ID.trim();
    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("google"));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("access_type", "offline");
    authorize.searchParams.set("prompt", "consent");
    authorize.searchParams.set("include_granted_scopes", "true");
    return { url: authorize.toString() };
  },

  async exchange(code) {
    const clientId = env.GOOGLE_CLIENT_ID.trim();
    const clientSecret = env.GOOGLE_CLIENT_SECRET.trim();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: oauthCallbackUrl("google"),
      }).toString(),
    });
    const tokenRaw: unknown = await tokenResponse.json();
    if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
      return { error: oauthErrorReason(tokenRaw) };
    }
    const userResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${tokenRaw.access_token}` } },
    );
    const userRaw: unknown = await userResponse.json();
    const email =
      isPlainObject(userRaw) && typeof userRaw.email === "string"
        ? userRaw.email
        : "google";
    const sub =
      isPlainObject(userRaw) && typeof userRaw.sub === "string"
        ? userRaw.sub
        : email;
    return grantFromTokenPayload(tokenRaw, { login: email, providerUserId: sub });
  },

  async refresh(connection) {
    if (connection.refreshToken === null) {
      if (
        connection.tokenExpiresAt === null ||
        connection.tokenExpiresAt > Date.now()
      ) {
        return { accessToken: connection.accessToken };
      }
      return null;
    }
    const clientId = env.GOOGLE_CLIENT_ID.trim();
    const clientSecret = env.GOOGLE_CLIENT_SECRET.trim();
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
      if (
        connection.tokenExpiresAt === null ||
        connection.tokenExpiresAt > Date.now()
      ) {
        return { accessToken: connection.accessToken };
      }
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
