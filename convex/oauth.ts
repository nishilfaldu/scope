import { env } from "./_generated/server";
import type { ProviderId } from "./permissions";

const REFRESH_SKEW_MS = 2 * 60 * 1000;

export type ConnectionSecrets = {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  login: string;
  providerUserId: string;
};

export type RefreshedTokens = {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export function oauthCallbackUrl(provider: ProviderId): string {
  return `${env.CONVEX_SITE_URL.replace(/\/$/, "")}/api/${provider}/callback`;
}

export async function refreshProviderTokens(
  provider: ProviderId,
  connection: ConnectionSecrets,
): Promise<RefreshedTokens | null> {
  switch (provider) {
    case "github":
      return await refreshGithub(connection);
    case "google":
      return await refreshGoogle(connection);
    case "slack":
      return await refreshSlack(connection);
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export async function revokeProviderGrant(
  provider: ProviderId,
  accessToken: string,
): Promise<void> {
  switch (provider) {
    case "github": {
      const clientId = env.GITHUB_CLIENT_ID?.trim();
      const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
      if (!clientId || !clientSecret) {
        return;
      }
      const basic = btoa(`${clientId}:${clientSecret}`);
      await fetch(`https://api.github.com/applications/${clientId}/grant`, {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${basic}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ access_token: accessToken }),
      });
      return;
    }
    case "google": {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: accessToken }).toString(),
      });
      return;
    }
    case "slack": {
      await fetch("https://slack.com/api/auth.revoke", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      return;
    }
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

async function refreshGithub(
  connection: ConnectionSecrets,
): Promise<RefreshedTokens | null> {
  if (
    connection.refreshToken === null ||
    (connection.tokenExpiresAt !== null &&
      connection.tokenExpiresAt > Date.now() + REFRESH_SKEW_MS &&
      connection.refreshToken.length === 0)
  ) {
    return { accessToken: connection.accessToken };
  }
  if (connection.refreshToken === null) {
    return { accessToken: connection.accessToken };
  }
  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return { accessToken: connection.accessToken };
  }
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: connection.refreshToken,
      }),
    },
  );
  const tokenRaw: unknown = await tokenResponse.json();
  if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
    return { accessToken: connection.accessToken };
  }
  const expiresIn = asFiniteNumber(tokenRaw.expires_in);
  return {
    accessToken: tokenRaw.access_token,
    refreshToken:
      typeof tokenRaw.refresh_token === "string"
        ? tokenRaw.refresh_token
        : connection.refreshToken,
    tokenExpiresAt:
      expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
  };
}

async function refreshGoogle(
  connection: ConnectionSecrets,
): Promise<RefreshedTokens | null> {
  if (connection.refreshToken === null) {
    if (
      connection.tokenExpiresAt === null ||
      connection.tokenExpiresAt > Date.now()
    ) {
      return { accessToken: connection.accessToken };
    }
    return null;
  }
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return { accessToken: connection.accessToken };
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
    if (
      connection.tokenExpiresAt === null ||
      connection.tokenExpiresAt > Date.now()
    ) {
      return { accessToken: connection.accessToken };
    }
    return null;
  }
  const expiresIn = asFiniteNumber(tokenRaw.expires_in);
  return {
    accessToken: tokenRaw.access_token,
    refreshToken:
      typeof tokenRaw.refresh_token === "string"
        ? tokenRaw.refresh_token
        : connection.refreshToken,
    tokenExpiresAt:
      expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
  };
}

async function refreshSlack(
  connection: ConnectionSecrets,
): Promise<RefreshedTokens | null> {
  if (connection.refreshToken === null) {
    return { accessToken: connection.accessToken };
  }
  const clientId = env.SLACK_CLIENT_ID?.trim();
  const clientSecret = env.SLACK_CLIENT_SECRET?.trim();
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
  const authed = isPlainObject(tokenRaw.authed_user) ? tokenRaw.authed_user : tokenRaw;
  if (!isPlainObject(authed) || typeof authed.access_token !== "string") {
    return { accessToken: connection.accessToken };
  }
  const expiresIn = asFiniteNumber(authed.expires_in);
  return {
    accessToken: authed.access_token,
    refreshToken:
      typeof authed.refresh_token === "string"
        ? authed.refresh_token
        : connection.refreshToken,
    tokenExpiresAt:
      expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
  };
}
