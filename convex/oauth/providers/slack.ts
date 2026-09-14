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

const SLACK_USER_SCOPES =
  "identify,channels:history,channels:read,chat:write,groups:read,im:history,im:read,users:read,search:read,files:read,files:write";

export const slack: ProviderOAuth = {
  authorize(state) {
    const clientId = envTrimmed(env.SLACK_CLIENT_ID);
    if (!clientId) {
      return { error: "Slack OAuth is not configured." };
    }
    const authorize = new URL("https://slack.com/oauth/v2/authorize");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("slack"));
    authorize.searchParams.set("user_scope", SLACK_USER_SCOPES);
    authorize.searchParams.set("state", state);
    return { url: authorize.toString() };
  },

  async exchange(code) {
    const clientId = envTrimmed(env.SLACK_CLIENT_ID);
    const clientSecret = envTrimmed(env.SLACK_CLIENT_SECRET);
    if (!clientId || !clientSecret) {
      return { error: "config" };
    }
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: oauthCallbackUrl("slack"),
      }).toString(),
    });
    const tokenRaw: unknown = await tokenResponse.json();
    if (!isPlainObject(tokenRaw) || tokenRaw.ok !== true) {
      return { error: oauthErrorReason(tokenRaw) };
    }
    const authed = isPlainObject(tokenRaw.authed_user)
      ? tokenRaw.authed_user
      : null;
    if (!authed || typeof authed.access_token !== "string") {
      return { error: "token" };
    }
    const userId = typeof authed.id === "string" ? authed.id : "slack";
    let login = userId;
    const userResponse = await fetch("https://slack.com/api/users.info", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authed.access_token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ user: userId }).toString(),
    });
    const userRaw: unknown = await userResponse.json();
    if (
      isPlainObject(userRaw) &&
      userRaw.ok === true &&
      isPlainObject(userRaw.user) &&
      typeof userRaw.user.name === "string"
    ) {
      login = userRaw.user.name;
    }
    return grantFromTokenPayload(authed, { login, providerUserId: userId });
  },

  async refresh(connection) {
    if (connection.refreshToken === null) {
      return { accessToken: connection.accessToken };
    }
    const clientId = envTrimmed(env.SLACK_CLIENT_ID);
    const clientSecret = envTrimmed(env.SLACK_CLIENT_SECRET);
    if (!clientId || !clientSecret) {
      return { accessToken: connection.accessToken };
    }
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
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
    if (!isPlainObject(tokenRaw) || tokenRaw.ok !== true) {
      return { accessToken: connection.accessToken };
    }
    const authed = isPlainObject(tokenRaw.authed_user)
      ? tokenRaw.authed_user
      : tokenRaw;
    if (!isPlainObject(authed) || typeof authed.access_token !== "string") {
      return { accessToken: connection.accessToken };
    }
    return refreshedFromPayload(authed, connection.refreshToken);
  },

  async revoke(accessToken) {
    await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  },
};
