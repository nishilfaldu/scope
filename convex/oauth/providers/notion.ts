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

const NOTION_VERSION = "2025-09-03";

function credentials() {
  const clientId = envTrimmed(env.NOTION_CLIENT_ID);
  const clientSecret = envTrimmed(env.NOTION_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
  };
}

async function tokenRequest(body: Record<string, string>) {
  const client = credentials();
  if (!client) return { error: "config" } as const;
  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: client.authorization,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify(body),
  });
  const raw: unknown = await response.json();
  if (!isPlainObject(raw) || typeof raw.access_token !== "string") {
    return { error: oauthErrorReason(raw) } as const;
  }
  return raw;
}

export const notion: ProviderOAuth = {
  authorize(state) {
    const client = credentials();
    if (!client) return { error: "Notion OAuth is not configured." };
    const authorize = new URL("https://api.notion.com/v1/oauth/authorize");
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("notion"));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("owner", "user");
    authorize.searchParams.set("state", state);
    return { url: authorize.toString() };
  },

  async exchange(code) {
    const raw = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: oauthCallbackUrl("notion"),
    });
    if ("error" in raw) return { error: String(raw.error) };
    const owner =
      isPlainObject(raw.owner) && isPlainObject(raw.owner.user)
        ? raw.owner.user
        : null;
    const login =
      owner && typeof owner.name === "string"
        ? owner.name
        : typeof raw.workspace_name === "string"
          ? raw.workspace_name
          : "notion";
    const providerUserId =
      owner && typeof owner.id === "string"
        ? owner.id
        : typeof raw.bot_id === "string"
          ? raw.bot_id
          : login;
    return grantFromTokenPayload(raw, { login, providerUserId });
  },

  async refresh(connection) {
    if (connection.refreshToken === null) {
      return { accessToken: connection.accessToken };
    }
    const raw = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    });
    if ("error" in raw) return { accessToken: connection.accessToken };
    return refreshedFromPayload(raw, connection.refreshToken);
  },

  async revoke(accessToken) {
    const client = credentials();
    if (!client) return;
    await fetch("https://api.notion.com/v1/oauth/revoke", {
      method: "POST",
      headers: {
        Authorization: client.authorization,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({ token: accessToken }),
    });
  },
};
