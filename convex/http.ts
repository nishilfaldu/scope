import { httpRouter, type GenericActionCtx } from "convex/server";
import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { lookupAction, runAction, type InvokeResult } from "./invoke";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const ARGS_PREVIEW_MAX = 400;
const REFRESH_SKEW_MS = 2 * 60 * 1000;
const GITHUB_PROVIDER = "github";
const GITHUB_OAUTH_SCOPES =
  "repo workflow user gist notifications delete_repo write:packages codespace project admin:public_key admin:repo_hook";

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
  const raw = JSON.stringify(args);
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
  github: string,
  reason?: string,
): Response {
  const url = new URL(returnTo);
  url.searchParams.set("github", github);
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

function oauthCallbackUrl(): string {
  return `${env.CONVEX_SITE_URL.replace(/\/$/, "")}/api/github/callback`;
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
  const redirectUri = oauthCallbackUrl();
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

async function resolveGithubToken(
  ctx: GenericActionCtx<DataModel>,
): Promise<string | null> {
  const row = await ctx.runQuery(internal.connections.getConnection, {
    provider: GITHUB_PROVIDER,
  });
  if (!row) {
    return null;
  }
  const stillFresh =
    row.tokenExpiresAt === null ||
    row.tokenExpiresAt > Date.now() + REFRESH_SKEW_MS;
  if (stillFresh || row.refreshToken === null) {
    return row.accessToken;
  }
  const client = githubClient();
  if (!client) {
    return row.accessToken;
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
        refresh_token: row.refreshToken,
      }),
    },
  );
  const tokenRaw: unknown = await tokenResponse.json();
  if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
    return row.accessToken;
  }
  const expiresIn =
    typeof tokenRaw.expires_in === "number" ? tokenRaw.expires_in : null;
  const accessToken = tokenRaw.access_token;
  const refreshToken =
    typeof tokenRaw.refresh_token === "string"
      ? tokenRaw.refresh_token
      : row.refreshToken;
  await ctx.runMutation(internal.connections.saveConnection, {
    provider: GITHUB_PROVIDER,
    accessToken,
    login: row.login,
    providerUserId: row.providerUserId,
    refreshToken,
    tokenExpiresAt:
      expiresIn === null ? undefined : Date.now() + expiresIn * 1000,
  });
  return accessToken;
}

const http = httpRouter();

http.route({
  path: "/api/invoke",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
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

    const { passportId, action, args: rawArgs } = raw;
    if (typeof passportId !== "string" || passportId.length === 0) {
      return jsonResponse(400, { error: "passportId must be a string" });
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

    const passport = await ctx.runQuery(internal.passports.getByToken, {
      token: passportId,
    });
    if (!passport) {
      return jsonResponse(401, { error: "Unknown passport" });
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
  path: "/api/github/connect",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const returnTo = allowedReturnTo(requestUrl.searchParams.get("returnTo"));
    const client = githubClient();
    if (!client) {
      return new Response("GitHub App is not configured.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const redirectUri = oauthCallbackUrl();
    const state = crypto.randomUUID();
    await ctx.runMutation(internal.connections.putOauthState, {
      provider: GITHUB_PROVIDER,
      state,
      returnTo,
    });

    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("prompt", "consent");
    if (usesClassicOauthScopes(client)) {
      authorize.searchParams.set("scope", GITHUB_OAUTH_SCOPES);
    }
    return Response.redirect(authorize.toString(), 302);
  }),
});

http.route({
  path: "/api/github/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const returnFallback = allowedReturnTo(null);
    const errorParam = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");

    if (errorParam) {
      return redirectTo(returnFallback, "denied");
    }
    if (typeof code !== "string") {
      return redirectTo(returnFallback, "error", "code");
    }

    if (typeof state !== "string") {
      return redirectTo(returnFallback, "error", "state");
    }
    const origin = await ctx.runMutation(
      internal.connections.consumeOauthState,
      { state },
    );
    if (!origin) {
      return redirectTo(returnFallback, "error", "state");
    }

    const client = githubClient();
    if (!client) {
      return redirectTo(origin, "error", "config");
    }

    const tokens = await exchangeOauthCode(client, code);
    if ("error" in tokens) {
      return redirectTo(origin, "error", tokens.error);
    }
    const user = await githubIdentity(tokens.accessToken);

    await ctx.runMutation(internal.connections.saveConnection, {
      provider: GITHUB_PROVIDER,
      accessToken: tokens.accessToken,
      login: user.login,
      providerUserId: user.providerUserId,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.tokenExpiresAt,
    });
    return redirectTo(origin, "connected");
  }),
});

http.route({
  path: "/api/github/webhook",
  method: "POST",
  handler: httpAction(async () => {
    return new Response(null, { status: 204 });
  }),
});

export default http;
