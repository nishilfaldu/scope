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

const SCOPES = "data.records:read data.records:write schema.bases:read schema.bases:write user.email:read";

function credentials() {
  const clientId = envTrimmed(env.AIRTABLE_CLIENT_ID);
  const clientSecret = envTrimmed(env.AIRTABLE_CLIENT_SECRET);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function codeVerifier(state: string) {
  return `${state.replaceAll("-", "")}.${state.replaceAll("-", "")}`;
}

async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function tokenRequest(body: Record<string, string>) {
  const client = credentials();
  if (!client) return { error: "config" } as const;
  const response = await fetch("https://airtable.com/oauth2/v1/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const raw: unknown = await response.json();
  if (!isPlainObject(raw) || typeof raw.access_token !== "string") {
    return { error: oauthErrorReason(raw) } as const;
  }
  return raw;
}

async function identity(accessToken: string) {
  const response = await fetch("https://api.airtable.com/v0/meta/whoami", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const raw: unknown = await response.json();
  const value = isPlainObject(raw) ? raw : {};
  const login = typeof value.email === "string" ? value.email : "airtable";
  return { login, providerUserId: typeof value.id === "string" && value.id ? value.id : "" };
}

export const airtable: ProviderOAuth = {
  async authorize(state) {
    const client = credentials();
    if (!client) return { error: "Airtable OAuth is not configured." };
    const verifier = codeVerifier(state);
    const authorize = new URL("https://airtable.com/oauth2/v1/authorize");
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("airtable"));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", SCOPES);
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", await codeChallenge(verifier));
    authorize.searchParams.set("code_challenge_method", "S256");
    return { url: authorize.toString() };
  },
  async exchange(code, state) {
    if (!state) return { error: "state" };
    const raw = await tokenRequest({
      code,
      redirect_uri: oauthCallbackUrl("airtable"),
      grant_type: "authorization_code",
      code_verifier: codeVerifier(state),
    });
    if ("error" in raw) return { error: String(raw.error) };
    return grantFromTokenPayload(raw, await identity(String(raw.access_token)));
  },
  async refresh(connection) {
    if (connection.refreshToken === null) return null;
    const raw = await tokenRequest({ grant_type: "refresh_token", refresh_token: connection.refreshToken });
    if ("error" in raw) return null;
    return refreshedFromPayload(raw, connection.refreshToken);
  },
  async revoke() {
    // Airtable exposes revocation to the user in account settings, not a token revocation endpoint.
  },
};
