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
import { VERCEL_SCOPES } from "../../domain/capabilities";

function credentials() {
  const clientId = envTrimmed(env.VERCEL_CLIENT_ID);
  const clientSecret = envTrimmed(env.VERCEL_CLIENT_SECRET);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function tokenRequest(body: Record<string, string>) {
  const client = credentials();
  if (!client) return { error: "config" } as const;
  const response = await fetch("https://api.vercel.com/login/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      ...body,
      client_id: client.clientId,
    }).toString(),
  });
  const raw: unknown = await response.json();
  if (!isPlainObject(raw) || typeof raw.access_token !== "string") {
    return { error: oauthErrorReason(raw) } as const;
  }
  return raw;
}

async function userInfo(accessToken: string) {
  const response = await fetch("https://api.vercel.com/login/oauth/userinfo", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const raw: unknown = await response.json();
  const info = isPlainObject(raw) ? raw : {};
  const login =
    typeof info.preferred_username === "string"
      ? info.preferred_username
      : typeof info.email === "string"
        ? info.email
        : typeof info.name === "string"
          ? info.name
          : "vercel";
  return {
    login,
    providerUserId: typeof info.sub === "string" && info.sub ? info.sub : "",
  };
}

export const vercel: ProviderOAuth = {
  authorize(state) {
    const client = credentials();
    if (!client) return { error: "Vercel OAuth is not configured." };
    const authorize = new URL("https://vercel.com/oauth/authorize");
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("vercel"));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set(
      "scope",
      VERCEL_SCOPES,
    );
    authorize.searchParams.set("state", state);
    return { url: authorize.toString() };
  },
  async exchange(code) {
    const raw = await tokenRequest({
      code,
      redirect_uri: oauthCallbackUrl("vercel"),
      grant_type: "authorization_code",
    });
    if ("error" in raw) return { error: String(raw.error) };
    return grantFromTokenPayload(raw, await userInfo(String(raw.access_token)));
  },
  async refresh(connection) {
    if (connection.refreshToken === null) return null;
    const raw = await tokenRequest({
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    });
    if ("error" in raw) return null;
    return refreshedFromPayload(raw, connection.refreshToken);
  },
  async revoke(accessToken) {
    const client = credentials();
    if (!client) return;
    await fetch("https://api.vercel.com/login/oauth/token/revoke", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: accessToken }).toString(),
    });
  },
};
