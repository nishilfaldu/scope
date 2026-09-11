import { httpRouter, type GenericActionCtx } from "convex/server";
import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { lookupAction, runAction, type InvokeResult } from "./invoke";
import {
  oauthCallbackUrl,
  refreshProviderTokens,
  type ConnectionSecrets,
} from "./oauth";
import { type ProviderId } from "./permissions";
import { PLATFORM_TOKEN_TTL_MS } from "./tokens";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const ARGS_PREVIEW_MAX = 400;
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

type GithubClient = {
  clientId: string;
  clientSecret: string;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function previewArgs(args: Record<string, unknown>): string {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    redacted[key] = /token|secret|key|authorization/i.test(key)
      ? "[redacted]"
      : value;
  }
  const raw = JSON.stringify(redacted);
  if (raw.length <= ARGS_PREVIEW_MAX) {
    return raw;
  }
  return `${raw.slice(0, ARGS_PREVIEW_MAX)}…`;
}

const ALLOWED_RETURN_PATHS = new Set(["/", "/connections"]);

function allowedReturnTo(value: string | null): string {
  const fallback = "http://localhost:3000/connections";
  if (!value) {
    return fallback;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallback;
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return fallback;
    }
    const path = ALLOWED_RETURN_PATHS.has(url.pathname)
      ? url.pathname
      : "/connections";
    return `${url.origin}${path}`;
  } catch {
    return fallback;
  }
}

function redirectTo(
  returnTo: string,
  provider: ProviderId,
  status: string,
  reason?: string,
): Response {
  const url = new URL(returnTo);
  url.searchParams.set(provider, status);
  if (reason) {
    url.searchParams.set("reason", reason);
  }
  return Response.redirect(url.toString(), 302);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function githubErrorReason(raw: unknown): string {
  if (isPlainObject(raw) && typeof raw.error === "string") {
    const error = raw.error.slice(0, 80);
    if (/^[a-z0-9_]+$/i.test(error)) {
      return error;
    }
  }
  return "token";
}

const GITHUB_FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "agent-passport",
};

async function requestAccessToken(
  params: Record<string, string>,
  mode: "body" | "query",
): Promise<Response> {
  if (mode === "query") {
    const url = new URL("https://github.com/login/oauth/access_token");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return await fetch(url.toString(), {
      method: "POST",
      headers: GITHUB_FETCH_HEADERS,
    });
  }
  return await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      ...GITHUB_FETCH_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
}

function githubClient(): GithubClient | null {
  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

function usesClassicOauthScopes(client: GithubClient): boolean {
  return !client.clientId.startsWith("Iv");
}

async function exchangeOauthCode(
  client: GithubClient,
  code: string,
): Promise<
  | {
      accessToken: string;
      refreshToken?: string;
      tokenExpiresAt?: number;
    }
  | { error: string }
> {
  const redirectUri = oauthCallbackUrl("github");
  const attempts: Array<Record<string, string>> = [
    {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      redirect_uri: redirectUri,
    },
    {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
    },
  ];

  let lastError = "token";
  for (const [index, params] of attempts.entries()) {
    const tokenResponse = await requestAccessToken(
      params,
      index === 0 ? "body" : "query",
    );
    const tokenRaw: unknown = await tokenResponse.json();
    if (isPlainObject(tokenRaw) && typeof tokenRaw.access_token === "string") {
      const expiresIn = asFiniteNumber(tokenRaw.expires_in);
      return {
        accessToken: tokenRaw.access_token,
        refreshToken:
          typeof tokenRaw.refresh_token === "string"
            ? tokenRaw.refresh_token
            : undefined,
        tokenExpiresAt:
          expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
      };
    }
    lastError = githubErrorReason(tokenRaw);
    console.error("GitHub token exchange failed", {
      status: tokenResponse.status,
      error: lastError,
      error_description: isPlainObject(tokenRaw)
        ? tokenRaw.error_description
        : null,
      usedRedirectUri: params.redirect_uri !== undefined,
    });
  }
  return { error: lastError };
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

  console.error("GitHub identity lookup failed", {
    userStatus: userResponse.status,
    instStatus: instResponse.status,
  });
  return { login: "github", providerUserId: "unknown" };
}

async function exchangeGoogleCode(code: string): Promise<
  | {
      accessToken: string;
      refreshToken?: string;
      tokenExpiresAt?: number;
      login: string;
      providerUserId: string;
    }
  | { error: string }
> {
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
    return { error: githubErrorReason(tokenRaw) };
  }
  const expiresIn = asFiniteNumber(tokenRaw.expires_in);
  const userResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${tokenRaw.access_token}` },
    },
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
  return {
    accessToken: tokenRaw.access_token,
    refreshToken:
      typeof tokenRaw.refresh_token === "string"
        ? tokenRaw.refresh_token
        : undefined,
    tokenExpiresAt:
      expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
    login: email,
    providerUserId: sub,
  };
}

async function exchangeSlackCode(code: string): Promise<
  | {
      accessToken: string;
      refreshToken?: string;
      tokenExpiresAt?: number;
      login: string;
      providerUserId: string;
    }
  | { error: string }
> {
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
    return { error: githubErrorReason(tokenRaw) };
  }
  const authed = isPlainObject(tokenRaw.authed_user)
    ? tokenRaw.authed_user
    : null;
  if (!authed || typeof authed.access_token !== "string") {
    return { error: "token" };
  }
  const expiresIn = asFiniteNumber(authed.expires_in);
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
  return {
    accessToken: authed.access_token,
    refreshToken:
      typeof authed.refresh_token === "string"
        ? authed.refresh_token
        : undefined,
    tokenExpiresAt:
      expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
    login,
    providerUserId: userId,
  };
}

async function resolveGithubToken(
  ctx: GenericActionCtx<DataModel>,
): Promise<string | null> {
  const row = await ctx.runQuery(internal.connections.getConnection, {
    provider: "github",
  });
  if (!row) {
    return null;
  }
  const refreshed = await refreshProviderTokens("github", row);
  if (!refreshed) {
    return row.accessToken;
  }
  if (refreshed.accessToken !== row.accessToken) {
    await ctx.runMutation(internal.connections.saveConnection, {
      provider: "github",
      accessToken: refreshed.accessToken,
      login: row.login,
      providerUserId: row.providerUserId,
      refreshToken: refreshed.refreshToken,
      tokenExpiresAt: refreshed.tokenExpiresAt,
    });
  }
  return refreshed.accessToken;
}

async function issueFromConnection(
  ctx: GenericActionCtx<DataModel>,
  provider: ProviderId,
  connection: ConnectionSecrets,
): Promise<{ accessToken: string; expiresAt: number } | { error: string }> {
  const refreshed = await refreshProviderTokens(provider, connection);
  if (!refreshed) {
    return { error: "Could not refresh platform token" };
  }
  if (
    refreshed.accessToken !== connection.accessToken ||
    refreshed.refreshToken !== undefined ||
    refreshed.tokenExpiresAt !== undefined
  ) {
    await ctx.runMutation(internal.connections.saveConnection, {
      provider,
      accessToken: refreshed.accessToken,
      login: connection.login,
      providerUserId: connection.providerUserId,
      refreshToken: refreshed.refreshToken ?? connection.refreshToken ?? undefined,
      tokenExpiresAt:
        refreshed.tokenExpiresAt ?? connection.tokenExpiresAt ?? undefined,
    });
  }
  const providerExpiry = refreshed.tokenExpiresAt ?? connection.tokenExpiresAt;
  const expiresAt = Math.min(
    Date.now() + PLATFORM_TOKEN_TTL_MS,
    providerExpiry ?? Date.now() + PLATFORM_TOKEN_TTL_MS,
  );
  return { accessToken: refreshed.accessToken, expiresAt };
}

const http = httpRouter();

http.route({
  path: "/api/invoke",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }),
});

http.route({
  path: "/api/invoke",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    if (!isPlainObject(raw)) {
      return jsonResponse(400, { error: "Body must be a JSON object" });
    }

    const { passportId, invokeKey, action, args: rawArgs } = raw;
    if (typeof passportId !== "string" || passportId.length === 0) {
      return jsonResponse(400, { error: "passportId must be a string" });
    }
    if (typeof invokeKey !== "string" || invokeKey.length === 0) {
      return jsonResponse(400, { error: "invokeKey must be a string" });
    }
    if (typeof action !== "string" || action.length === 0) {
      return jsonResponse(400, { error: "action must be a string" });
    }

    let args: Record<string, unknown> = {};
    if (rawArgs !== undefined) {
      if (!isPlainObject(rawArgs)) {
        return jsonResponse(400, { error: "args must be an object" });
      }
      args = rawArgs;
    }

    const passport = await ctx.runQuery(internal.passports.getByCredentials, {
      token: passportId,
      invokeKey,
    });
    if (!passport) {
      return jsonResponse(401, { error: "Unknown passport or invoke key" });
    }

    const preview = previewArgs(args);
    const decision = await ctx.runMutation(internal.audit.recordPresentation, {
      passportId: passport._id,
      action,
      argsPreview: preview,
    });
    if (!decision.allowRun) {
      return jsonResponse(decision.status, { error: decision.reason });
    }

    const spec = lookupAction(action);
    if (!spec) {
      return jsonResponse(400, { error: `Unknown action: ${action}` });
    }

    const githubToken = await resolveGithubToken(ctx);
    const result: InvokeResult = await runAction(spec, args, {
      passportName: passport.name,
      githubToken,
    });
    await ctx.runMutation(internal.audit.recordUse, {
      passportId: passport._id,
      action,
      argsPreview: preview,
      ok: result.ok,
      status: result.status,
      error: result.error,
    });
    return jsonResponse(result.status, result.body);
  }),
});

http.route({
  path: "/api/credentials",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }),
});

http.route({
  path: "/api/credentials",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }
    if (!isPlainObject(raw)) {
      return jsonResponse(400, { error: "Body must be a JSON object" });
    }
    const { passportId, invokeKey, platform, refresh: refreshRaw } = raw;
    if (typeof passportId !== "string" || passportId.length === 0) {
      return jsonResponse(400, { error: "passportId must be a string" });
    }
    if (typeof invokeKey !== "string" || invokeKey.length === 0) {
      return jsonResponse(400, { error: "invokeKey must be a string" });
    }
    if (typeof platform !== "string" || platform.length === 0) {
      return jsonResponse(400, { error: "platform must be a string" });
    }
    const refresh = refreshRaw === true;

    const decision = await ctx.runMutation(internal.tokens.authorizeMint, {
      passportToken: passportId,
      invokeKey,
      platform,
      refresh,
    });
    if (!decision.ok) {
      return jsonResponse(decision.status, { error: decision.reason });
    }

    const connection = await ctx.runQuery(internal.connections.getConnection, {
      provider: decision.provider,
    });
    if (!connection) {
      const reason = `${decision.provider} is not connected`;
      await ctx.runMutation(internal.tokens.logMintDenied, {
        passportId: decision.passportId,
        platform: decision.platform,
        reason,
      });
      return jsonResponse(403, { error: reason });
    }

    const issued = await issueFromConnection(
      ctx,
      decision.provider,
      connection,
    );
    if ("error" in issued) {
      await ctx.runMutation(internal.tokens.logMintDenied, {
        passportId: decision.passportId,
        platform: decision.platform,
        reason: issued.error,
      });
      return jsonResponse(503, { error: issued.error });
    }

    const committed = await ctx.runMutation(internal.tokens.commitMint, {
      passportId: decision.passportId,
      platform: decision.platform,
      accessToken: issued.accessToken,
      expiresAt: issued.expiresAt,
      refresh,
    });
    return jsonResponse(200, {
      accessToken: issued.accessToken,
      tokenType: "Bearer",
      platform: decision.platform,
      expiresAt: committed.expiresAt,
      expiresIn: Math.max(0, Math.floor((committed.expiresAt - Date.now()) / 1000)),
    });
  }),
});

function connectHandler(provider: ProviderId) {
  return httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const returnTo = allowedReturnTo(requestUrl.searchParams.get("returnTo"));

    if (provider === "github") {
      const client = githubClient();
      if (!client) {
        return new Response("GitHub App is not configured.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      const state = crypto.randomUUID();
      await ctx.runMutation(internal.connections.putOauthState, {
        provider,
        state,
        returnTo,
      });
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", client.clientId);
      authorize.searchParams.set("redirect_uri", oauthCallbackUrl("github"));
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("prompt", "consent");
      if (usesClassicOauthScopes(client)) {
        authorize.searchParams.set("scope", GITHUB_OAUTH_SCOPES);
      }
      return Response.redirect(authorize.toString(), 302);
    }

    if (provider === "google") {
      const clientId = env.GOOGLE_CLIENT_ID?.trim();
      if (!clientId) {
        return new Response("Google OAuth is not configured.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      const state = crypto.randomUUID();
      await ctx.runMutation(internal.connections.putOauthState, {
        provider,
        state,
        returnTo,
      });
      const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorize.searchParams.set("client_id", clientId);
      authorize.searchParams.set("redirect_uri", oauthCallbackUrl("google"));
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("access_type", "offline");
      authorize.searchParams.set("prompt", "consent");
      authorize.searchParams.set("include_granted_scopes", "true");
      return Response.redirect(authorize.toString(), 302);
    }

    const clientId = env.SLACK_CLIENT_ID?.trim();
    if (!clientId) {
      return new Response("Slack OAuth is not configured.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const state = crypto.randomUUID();
    await ctx.runMutation(internal.connections.putOauthState, {
      provider,
      state,
      returnTo,
    });
    const authorize = new URL("https://slack.com/oauth/v2/authorize");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", oauthCallbackUrl("slack"));
    authorize.searchParams.set("user_scope", SLACK_USER_SCOPES);
    authorize.searchParams.set("state", state);
    return Response.redirect(authorize.toString(), 302);
  });
}

function callbackHandler(provider: ProviderId) {
  return httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const returnFallback = allowedReturnTo(null);
    const errorParam = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");

    if (errorParam) {
      return redirectTo(returnFallback, provider, "denied");
    }
    if (typeof code !== "string") {
      return redirectTo(returnFallback, provider, "error", "code");
    }
    if (typeof state !== "string") {
      return redirectTo(returnFallback, provider, "error", "state");
    }
    const origin = await ctx.runMutation(
      internal.connections.consumeOauthState,
      { state },
    );
    if (!origin || origin.provider !== provider) {
      return redirectTo(returnFallback, provider, "error", "state");
    }

    if (provider === "github") {
      const client = githubClient();
      if (!client) {
        return redirectTo(origin.returnTo, provider, "error", "config");
      }
      const tokens = await exchangeOauthCode(client, code);
      if ("error" in tokens) {
        return redirectTo(origin.returnTo, provider, "error", tokens.error);
      }
      const user = await githubIdentity(tokens.accessToken);
      await ctx.runMutation(internal.connections.saveConnection, {
        provider,
        accessToken: tokens.accessToken,
        login: user.login,
        providerUserId: user.providerUserId,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.tokenExpiresAt,
      });
      return redirectTo(origin.returnTo, provider, "connected");
    }

    if (provider === "google") {
      const tokens = await exchangeGoogleCode(code);
      if ("error" in tokens) {
        return redirectTo(origin.returnTo, provider, "error", tokens.error);
      }
      await ctx.runMutation(internal.connections.saveConnection, {
        provider,
        accessToken: tokens.accessToken,
        login: tokens.login,
        providerUserId: tokens.providerUserId,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.tokenExpiresAt,
      });
      return redirectTo(origin.returnTo, provider, "connected");
    }

    const tokens = await exchangeSlackCode(code);
    if ("error" in tokens) {
      return redirectTo(origin.returnTo, provider, "error", tokens.error);
    }
    await ctx.runMutation(internal.connections.saveConnection, {
      provider,
      accessToken: tokens.accessToken,
      login: tokens.login,
      providerUserId: tokens.providerUserId,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.tokenExpiresAt,
    });
    return redirectTo(origin.returnTo, provider, "connected");
  });
}

http.route({
  path: "/api/github/connect",
  method: "GET",
  handler: connectHandler("github"),
});
http.route({
  path: "/api/github/callback",
  method: "GET",
  handler: callbackHandler("github"),
});
http.route({
  path: "/api/google/connect",
  method: "GET",
  handler: connectHandler("google"),
});
http.route({
  path: "/api/google/callback",
  method: "GET",
  handler: callbackHandler("google"),
});
http.route({
  path: "/api/slack/connect",
  method: "GET",
  handler: connectHandler("slack"),
});
http.route({
  path: "/api/slack/callback",
  method: "GET",
  handler: callbackHandler("slack"),
});

http.route({
  path: "/api/github/webhook",
  method: "POST",
  handler: httpAction(async () => {
    return new Response(null, { status: 204 });
  }),
});

export default http;
