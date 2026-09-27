import { env } from "../../_generated/server";
import { isPlainObject } from "../../lib/json";
import {
  envTrimmed,
  grantFromTokenPayload,
  oauthCallbackUrl,
  oauthErrorReason,
  refreshedFromPayload,
} from "../shared";
import {
  googleScopesAreBounded,
  isGoogleApp,
  scopesForGoogleApp,
  type GoogleAppId,
} from "../../domain/apps";
import type { ProviderOAuth } from "../types";

const IDENTITY_URL: Record<GoogleAppId, string> = {
  gmail:
    "https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress",
  calendar:
    "https://www.googleapis.com/calendar/v3/calendars/primary?fields=id",
  files:
    "https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,me)",
};

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Keys identify service accounts within an app, not a cross-app Google sub. */
async function serviceIdentity(app: GoogleAppId, accessToken: string) {
  try {
    const response = await fetch(IDENTITY_URL[app], {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
    });
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    if (!isPlainObject(raw)) return null;
    if (app === "gmail") {
      const email = nonempty(raw.emailAddress);
      return email
        ? { login: email, providerUserId: `gmail:${email.toLowerCase()}` }
        : null;
    }
    if (app === "calendar") {
      // primary resolves to this authenticated user's calendar. dataOwner is
      // only defined for secondary calendars; id need not be the current email.
      const id = nonempty(raw.id);
      return id && id !== "primary"
        ? { login: id, providerUserId: `calendar:${id}` }
        : null;
    }
    if (!isPlainObject(raw.user) || raw.user.me !== true) return null;
    const id = nonempty(raw.user.permissionId);
    return id
      ? {
          login: nonempty(raw.user.emailAddress) ?? `Drive account ${id}`,
          providerUserId: `drive:${id}`,
        }
      : null;
  } catch {
    // Never include upstream bodies, bearer tokens, or account data in errors.
    return null;
  }
}

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
    if (
      !tokenResponse.ok ||
      !isPlainObject(tokenRaw) ||
      !nonempty(tokenRaw.access_token)
    ) {
      return { error: oauthErrorReason(tokenRaw) };
    }
    if (
      !googleScopesAreBounded(
        app,
        typeof tokenRaw.scope === "string"
          ? tokenRaw.scope.split(/[\s,]+/).filter(Boolean)
          : undefined,
      )
    ) {
      return { error: "scope" };
    }
    const identity = await serviceIdentity(app, String(tokenRaw.access_token));
    if (!identity) return { error: "identity" };
    return grantFromTokenPayload(tokenRaw, identity);
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
    if (
      !tokenResponse.ok ||
      !isPlainObject(tokenRaw) ||
      !nonempty(tokenRaw.access_token)
    ) {
      return null;
    }
    // Only an omitted scope can inherit the previously verified grant.
    if (tokenRaw.scope !== undefined && typeof tokenRaw.scope !== "string")
      return null;
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
