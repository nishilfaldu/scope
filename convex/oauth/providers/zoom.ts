import { env } from "../../_generated/server";
import { isPlainObject } from "../../lib/json";
import { envTrimmed, grantFromTokenPayload, oauthCallbackUrl, oauthErrorReason, refreshedFromPayload } from "../shared";
import type { ProviderOAuth } from "../types";

function credentials() {
  const clientId = envTrimmed(env.ZOOM_CLIENT_ID);
  const clientSecret = envTrimmed(env.ZOOM_CLIENT_SECRET);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function tokenRequest(body: Record<string, string>) {
  const client = credentials();
  if (!client) return { error: "config" } as const;
  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const raw: unknown = await response.json();
  if (!isPlainObject(raw) || typeof raw.access_token !== "string") return { error: oauthErrorReason(raw) } as const;
  return raw;
}

async function identity(accessToken: string) {
  const response = await fetch("https://api.zoom.us/v2/users/me", { headers: { Authorization: `Bearer ${accessToken}` } });
  const raw: unknown = await response.json();
  const value = isPlainObject(raw) ? raw : {};
  const login = typeof value.email === "string" ? value.email : "zoom";
  return { login, providerUserId: typeof value.id === "string" && value.id ? value.id : "" };
}

export const zoom: ProviderOAuth = {
  authorize(state) {
    const client = credentials();
    if (!client) return { error: "Zoom OAuth is not configured." };
    const authorize = new URL("https://zoom.us/oauth/authorize");
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("zoom"));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("state", state);
    return { url: authorize.toString() };
  },
  async exchange(code) {
    const raw = await tokenRequest({ code, redirect_uri: oauthCallbackUrl("zoom"), grant_type: "authorization_code" });
    if ("error" in raw) return { error: String(raw.error) };
    return grantFromTokenPayload(raw, await identity(String(raw.access_token)));
  },
  async refresh(connection) {
    if (connection.refreshToken === null) return null;
    const raw = await tokenRequest({ grant_type: "refresh_token", refresh_token: connection.refreshToken });
    if ("error" in raw) return null;
    return refreshedFromPayload(raw, connection.refreshToken);
  },
  async revoke(accessToken) {
    const client = credentials();
    if (!client) return;
    await fetch("https://zoom.us/oauth/revoke", {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken }).toString(),
    });
  },
};
