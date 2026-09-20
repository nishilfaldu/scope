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

function credentials() {
  const clientId = envTrimmed(env.LINEAR_CLIENT_ID);
  const clientSecret = envTrimmed(env.LINEAR_CLIENT_SECRET);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function tokenRequest(body: Record<string, string>) {
  const client = credentials();
  if (!client) return { error: "config" } as const;
  const response = await fetch("https://api.linear.app/oauth/token", {
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

async function viewer(accessToken: string) {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "query Me { viewer { id name email } }" }),
  });
  const raw: unknown = await response.json();
  const value =
    isPlainObject(raw) &&
    isPlainObject(raw.data) &&
    isPlainObject(raw.data.viewer)
      ? raw.data.viewer
      : null;
  const login =
    value && typeof value.email === "string"
      ? value.email
      : value && typeof value.name === "string"
        ? value.name
        : "linear";
  const providerUserId =
    value && typeof value.id === "string" && value.id ? value.id : "";
  return { login, providerUserId };
}

export const linear: ProviderOAuth = {
  authorize(state) {
    const client = credentials();
    if (!client) return { error: "Linear OAuth is not configured." };
    const authorize = new URL("https://linear.app/oauth/authorize");
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("linear"));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", "read,write,admin");
    authorize.searchParams.set("actor", "user");
    authorize.searchParams.set("state", state);
    return { url: authorize.toString() };
  },
  async exchange(code) {
    const raw = await tokenRequest({
      code,
      redirect_uri: oauthCallbackUrl("linear"),
      grant_type: "authorization_code",
    });
    if ("error" in raw) return { error: String(raw.error) };
    return grantFromTokenPayload(raw, await viewer(String(raw.access_token)));
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
    await fetch("https://api.linear.app/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken }).toString(),
    });
  },
};
