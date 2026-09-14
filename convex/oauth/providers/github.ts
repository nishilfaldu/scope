import { env } from "../../_generated/server";
import { asFiniteNumber, isPlainObject } from "../../json";
import {
  REFRESH_SKEW_MS,
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
    "User-Agent": "agent-passport",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const userResponse = await fetch("https://api.github.com/user", { headers });
  const userRaw: unknown = await userResponse.json();
  if (isPlainObject(userRaw) && typeof userRaw.login === "string") {
    return {
      login: userRaw.login,
      providerUserId: String(asFiniteNumber(userRaw.id) ?? userRaw.login),
    };
  }
  const instResponse = await fetch("https://api.github.com/user/installations", {
    headers,
  });
  const instRaw: unknown = await instResponse.json();
  if (
    isPlainObject(instRaw) &&
    Array.isArray(instRaw.installations) &&
    instRaw.installations.length > 0
  ) {
    const first = instRaw.installations[0];
    if (
      isPlainObject(first) &&
      isPlainObject(first.account) &&
      typeof first.account.login === "string"
    ) {
      return {
        login: first.account.login,
        providerUserId: String(
          asFiniteNumber(first.account.id) ?? first.account.login,
        ),
      };
    }
  }
  return { login: "github", providerUserId: "unknown" };
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
    const attempts: Array<{ params: Record<string, string>; mode: "body" | "query" }> = [
      {
        mode: "body",
        params: {
          client_id: client.clientId,
          client_secret: client.clientSecret,
          code,
          redirect_uri: redirectUri,
        },
      },
      {
        mode: "query",
        params: {
          client_id: client.clientId,
          client_secret: client.clientSecret,
          code,
        },
      },
    ];
    let lastError = "token";
    for (const attempt of attempts) {
      const tokenResponse =
        attempt.mode === "query"
          ? await fetch(
              `https://github.com/login/oauth/access_token?${new URLSearchParams(attempt.params).toString()}`,
              {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "User-Agent": "agent-passport",
                },
              },
            )
          : await fetch("https://github.com/login/oauth/access_token", {
              method: "POST",
              headers: {
                Accept: "application/json",
                "User-Agent": "agent-passport",
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams(attempt.params).toString(),
            });
      const tokenRaw: unknown = await tokenResponse.json();
      if (isPlainObject(tokenRaw) && typeof tokenRaw.access_token === "string") {
        const identity = await githubIdentity(tokenRaw.access_token);
        return grantFromTokenPayload(tokenRaw, identity);
      }
      lastError = oauthErrorReason(tokenRaw);
    }
    return { error: lastError };
  },

  async refresh(connection) {
    if (connection.refreshToken === null) {
      return { accessToken: connection.accessToken };
    }
    const client = githubClient();
    if (!client) {
      return { accessToken: connection.accessToken };
    }
    if (
      connection.tokenExpiresAt !== null &&
      connection.tokenExpiresAt > Date.now() + REFRESH_SKEW_MS
    ) {
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
          client_id: client.clientId,
          client_secret: client.clientSecret,
          grant_type: "refresh_token",
          refresh_token: connection.refreshToken,
        }),
      },
    );
    const tokenRaw: unknown = await tokenResponse.json();
    if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
      return { accessToken: connection.accessToken };
    }
    return refreshedFromPayload(tokenRaw, connection.refreshToken);
  },

  async revoke(accessToken) {
    const client = githubClient();
    if (!client) {
      return;
    }
    const basic = btoa(`${client.clientId}:${client.clientSecret}`);
    await fetch(`https://api.github.com/applications/${client.clientId}/grant`, {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Basic ${basic}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
  },
};
