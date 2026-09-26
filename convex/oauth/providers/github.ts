import { env } from "../../_generated/server";
import { asFiniteNumber, isPlainObject } from "../../lib/json";
import {
  envTrimmed,
  grantFromTokenPayload,
  oauthCallbackUrl,
  oauthErrorReason,
  refreshedFromPayload,
} from "../shared";
import type { ProviderOAuth } from "../types";

const GITHUB_OAUTH_SCOPES =
  "repo workflow user gist notifications delete_repo write:packages codespace project admin:public_key admin:repo_hook";

function githubClient(): { clientId: string; clientSecret: string } | null {
  const clientId = envTrimmed(env.GITHUB_CLIENT_ID);
  const clientSecret = envTrimmed(env.GITHUB_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

async function githubIdentity(
  accessToken: string,
): Promise<{ login: string; providerUserId: string }> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "scope-app",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const userResponse = await fetch("https://api.github.com/user", { headers });
  const userRaw: unknown = await userResponse.json();
  if (
    isPlainObject(userRaw) &&
    typeof userRaw.login === "string" &&
    asFiniteNumber(userRaw.id) !== null
  ) {
    return {
      login: userRaw.login,
      providerUserId: String(asFiniteNumber(userRaw.id)),
    };
  }
  throw new Error("GitHub did not return a stable account ID");
}

export const github: ProviderOAuth = {
  authorize(state) {
    const client = githubClient();
    if (!client) {
      return { error: "GitHub App is not configured." };
    }
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("github"));
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("prompt", "consent");
    if (!client.clientId.startsWith("Iv")) {
      authorize.searchParams.set("scope", GITHUB_OAUTH_SCOPES);
    }
    return { url: authorize.toString() };
  },

  async exchange(code) {
    const client = githubClient();
    if (!client) {
      return { error: "config" };
    }
    const redirectUri = oauthCallbackUrl("github");
    const attempts: Array<Record<string, string>> = [
      {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        redirect_uri: redirectUri,
      },
    ];
    let lastError = "token";
    for (const attempt of attempts) {
      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "User-Agent": "scope-app",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(attempt).toString(),
        },
      );
      const tokenRaw: unknown = await tokenResponse.json();
      if (
        isPlainObject(tokenRaw) &&
        typeof tokenRaw.access_token === "string"
      ) {
        const identity = await githubIdentity(tokenRaw.access_token);
        return grantFromTokenPayload(tokenRaw, identity);
      }
      lastError = oauthErrorReason(tokenRaw);
    }
    return { error: lastError };
  },

  /**
   * Mint a fresh user access token via refresh_token grant.
   * Classic OAuth Apps / standing-only user tokens (no refresh) hard-fail:
   * never return the vault standing access token.
   */
  async refresh(connection) {
    if (connection.refreshToken === null) {
      return null;
    }
    const client = githubClient();
    if (!client) {
      return null;
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
          client_id: client.clientId,
          client_secret: client.clientSecret,
          grant_type: "refresh_token",
          refresh_token: connection.refreshToken,
        }),
      },
    );
    const tokenRaw: unknown = await tokenResponse.json();
    if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
      return null;
    }
    return refreshedFromPayload(tokenRaw, connection.refreshToken);
  },

  async revoke(accessToken) {
    const client = githubClient();
    if (!client) {
      return;
    }
    const basic = btoa(`${client.clientId}:${client.clientSecret}`);
    await fetch(
      `https://api.github.com/applications/${client.clientId}/grant`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${basic}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ access_token: accessToken }),
      },
    );
  },
};
