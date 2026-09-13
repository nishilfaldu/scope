import { env } from "./_generated/server";
import { asFiniteNumber, isPlainObject } from "./json";
import type { ProviderId } from "./permissions";

const REFRESH_SKEW_MS = 2 * 60 * 1000;
const GITHUB_OAUTH_SCOPES =
  "repo workflow user gist notifications delete_repo write:packages codespace project admin:public_key admin:repo_hook";
const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");
const SLACK_USER_SCOPES =
  "identify,channels:history,channels:read,chat:write,groups:read,im:history,im:read,users:read,search:read,files:read,files:write";

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

export type OAuthGrant = RefreshedTokens & {
  login: string;
  providerUserId: string;
};

type AuthorizeStart = { url: string } | { error: string };

function oauthErrorReason(raw: unknown): string {
  if (isPlainObject(raw) && typeof raw.error === "string") {
    const error = raw.error.slice(0, 80);
    if (/^[a-z0-9_]+$/i.test(error)) {
      return error;
    }
  }
  return "token";
}

function oauthCallbackUrl(provider: ProviderId): string {
  return `${env.CONVEX_SITE_URL.replace(/\/$/, "")}/api/${provider}/callback`;
}

function grantFromTokenPayload(
  tokenRaw: Record<string, unknown>,
  identity: { login: string; providerUserId: string },
): OAuthGrant {
  const expiresIn = asFiniteNumber(tokenRaw.expires_in);
  return {
    accessToken: String(tokenRaw.access_token),
    refreshToken:
      typeof tokenRaw.refresh_token === "string"
        ? tokenRaw.refresh_token
        : undefined,
    tokenExpiresAt:
      expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
    login: identity.login,
    providerUserId: identity.providerUserId,
  };
}

function refreshedFromPayload(
  tokenRaw: Record<string, unknown>,
  fallbackRefresh: string | null,
): RefreshedTokens {
  const expiresIn = asFiniteNumber(tokenRaw.expires_in);
  return {
    accessToken: String(tokenRaw.access_token),
    refreshToken:
      typeof tokenRaw.refresh_token === "string"
        ? tokenRaw.refresh_token
        : fallbackRefresh ?? undefined,
    tokenExpiresAt:
      expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
  };
}

type ProviderOAuth = {
  authorize: (state: string) => AuthorizeStart;
  exchange: (code: string) => Promise<OAuthGrant | { error: string }>;
  refresh: (connection: ConnectionSecrets) => Promise<RefreshedTokens | null>;
  revoke: (accessToken: string) => Promise<void>;
};

function githubClient(): { clientId: string; clientSecret: string } | null {
  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

const github: ProviderOAuth = {
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

const google: ProviderOAuth = {
  authorize(state) {
    const clientId = env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      return { error: "Google OAuth is not configured." };
    }
    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("google"));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("access_type", "offline");
    authorize.searchParams.set("prompt", "consent");
    authorize.searchParams.set("include_granted_scopes", "true");
    return { url: authorize.toString() };
  },

  async exchange(code) {
    const clientId = env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
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
        redirect_uri: oauthCallbackUrl("google"),
      }).toString(),
    });
    const tokenRaw: unknown = await tokenResponse.json();
    if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
      return { error: oauthErrorReason(tokenRaw) };
    }
    const userResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${tokenRaw.access_token}` } },
    );
    const userRaw: unknown = await userResponse.json();
    const email =
      isPlainObject(userRaw) && typeof userRaw.email === "string"
        ? userRaw.email
        : "google";
    const sub =
      isPlainObject(userRaw) && typeof userRaw.sub === "string"
        ? userRaw.sub
        : email;
    return grantFromTokenPayload(tokenRaw, { login: email, providerUserId: sub });
  },

  async refresh(connection) {
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

const slack: ProviderOAuth = {
  authorize(state) {
    const clientId = env.SLACK_CLIENT_ID?.trim();
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
    const clientId = env.SLACK_CLIENT_ID?.trim();
    const clientSecret = env.SLACK_CLIENT_SECRET?.trim();
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

const PROVIDER_OAUTH: Record<ProviderId, ProviderOAuth> = {
  github,
  google,
  slack,
};

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

export function oauthConfigured(): Record<ProviderId, boolean> {
  return {
    github:
      Boolean(env.GITHUB_CLIENT_ID?.trim()) &&
      Boolean(env.GITHUB_CLIENT_SECRET?.trim()),
    google:
      Boolean(env.GOOGLE_CLIENT_ID?.trim()) &&
      Boolean(env.GOOGLE_CLIENT_SECRET?.trim()),
    slack:
      Boolean(env.SLACK_CLIENT_ID?.trim()) &&
      Boolean(env.SLACK_CLIENT_SECRET?.trim()),
  };
}

export function startAuthorize(
  provider: ProviderId,
  state: string,
): AuthorizeStart {
  return PROVIDER_OAUTH[provider].authorize(state);
}

export async function exchangeAuthorizationCode(
  provider: ProviderId,
  code: string,
): Promise<OAuthGrant | { error: string }> {
  return await PROVIDER_OAUTH[provider].exchange(code);
}

export async function refreshProviderTokens(
  provider: ProviderId,
  connection: ConnectionSecrets,
): Promise<RefreshedTokens | null> {
  return await PROVIDER_OAUTH[provider].refresh(connection);
}

export async function revokeProviderGrant(
  provider: ProviderId,
  accessToken: string,
): Promise<void> {
  await PROVIDER_OAUTH[provider].revoke(accessToken);
}
