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
const GITHUB_OAUTH_SCOPES =
  "repo workflow user gist notifications delete_repo write:packages codespace project admin:public_key admin:repo_hook";

const GITHUB_APP_PERMISSIONS: Record<string, "read" | "write"> = {
  actions: "write",
  administration: "write",
  checks: "write",
  codespaces: "write",
  contents: "write",
  dependabot_secrets: "write",
  deployments: "write",
  discussions: "write",
  environments: "write",
  issues: "write",
  metadata: "read",
  packages: "write",
  pages: "write",
  pull_requests: "write",
  repository_hooks: "write",
  secrets: "write",
  statuses: "write",
  workflows: "write",
  email_addresses: "read",
  followers: "write",
  git_ssh_keys: "write",
  gpg_keys: "write",
  profile: "write",
  starring: "write",
};

type GithubClient = {
  clientId: string;
  clientSecret: string;
  slug: string | null;
  pendingReturnTo: string | null;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
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

function denied(status: number, error: string): InvokeResult {
  return { ok: false, status, body: { error }, error };
}

function allowedReturnTo(value: string | null): string {
  const fallback = "http://localhost:3000";
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
    return url.origin;
  } catch {
    return fallback;
  }
}

function redirectTo(origin: string, github: string): Response {
  const url = new URL("/", origin);
  url.searchParams.set("github", github);
  return Response.redirect(url.toString(), 302);
}

function oauthCallbackUrl(): string {
  return `${env.CONVEX_SITE_URL}/api/github/callback`;
}

async function loadClient(
  ctx: GenericActionCtx<DataModel>,
): Promise<GithubClient | null> {
  const envId = env.GITHUB_CLIENT_ID;
  const envSecret = env.GITHUB_CLIENT_SECRET;
  if (envId && envSecret) {
    return {
      clientId: envId,
      clientSecret: envSecret,
      slug: null,
      pendingReturnTo: null,
    };
  }
  return await ctx.runQuery(internal.githubAuth.getClient, {});
}

function manifestForm(returnTo: string): string {
  const site = env.CONVEX_SITE_URL;
  const manifest = {
    name: `Agent Passport ${crypto.randomUUID().slice(0, 8)}`,
    url: returnTo,
    description: "Agents act on GitHub as you. The token never leaves this server.",
    public: false,
    redirect_url: `${site}/api/github/manifest`,
    setup_url: `${site}/api/github/connect?returnTo=${encodeURIComponent(returnTo)}`,
    callback_urls: [oauthCallbackUrl()],
    request_oauth_on_install: true,
    hook_attributes: {
      url: `${site}/api/github/webhook`,
      active: false,
    },
    default_permissions: GITHUB_APP_PERMISSIONS,
    default_events: [] as string[],
  };
  const payload = JSON.stringify(manifest).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Connect GitHub</title></head>
  <body>
    <p>Redirecting to GitHub…</p>
    <form id="manifest" action="https://github.com/settings/apps/new?state=${encodeURIComponent(returnTo)}" method="post">
      <input type="hidden" name="manifest" value="${payload.replaceAll('"', "&quot;")}" />
    </form>
    <script>document.getElementById("manifest").submit()</script>
  </body>
</html>`;
}

async function exchangeOauthCode(
  client: GithubClient,
  code: string,
): Promise<{
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
} | null> {
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
        code,
        redirect_uri: oauthCallbackUrl(),
      }),
    },
  );
  const tokenRaw: unknown = await tokenResponse.json();
  if (!isPlainObject(tokenRaw) || typeof tokenRaw.access_token !== "string") {
    return null;
  }
  const expiresIn =
    typeof tokenRaw.expires_in === "number" ? tokenRaw.expires_in : null;
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

async function githubLogin(
  accessToken: string,
): Promise<{ login: string; githubUserId: number } | null> {
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const userRaw: unknown = await userResponse.json();
  if (
    !isPlainObject(userRaw) ||
    typeof userRaw.login !== "string" ||
    typeof userRaw.id !== "number"
  ) {
    return null;
  }
  return { login: userRaw.login, githubUserId: userRaw.id };
}

async function resolveGithubToken(
  ctx: GenericActionCtx<DataModel>,
): Promise<string | null> {
  const row = await ctx.runQuery(internal.githubAuth.getConnection, {});
  if (!row) {
    return null;
  }
  const stillFresh =
    row.tokenExpiresAt === null ||
    row.tokenExpiresAt > Date.now() + REFRESH_SKEW_MS;
  if (stillFresh || row.refreshToken === null) {
    return row.accessToken;
  }
  const client = await loadClient(ctx);
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
  await ctx.runMutation(internal.githubAuth.saveConnection, {
    accessToken,
    login: row.login,
    githubUserId: row.githubUserId,
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

    const spec = lookupAction(action);
    const githubToken = await resolveGithubToken(ctx);
    let result: InvokeResult;
    if (passport.status === "revoked") {
      result = denied(403, "Passport revoked");
    } else if (passport.expiresAt <= Date.now()) {
      result = denied(403, "Passport expired");
    } else if (!spec) {
      result = denied(400, `Unknown action: ${action}`);
    } else if (!passport.apps.includes(spec.app)) {
      result = denied(403, "Action not permitted");
    } else {
      result = await runAction(spec, args, {
        passportName: passport.name,
        githubToken,
      });
    }

    await ctx.runMutation(internal.passports.appendLog, {
      passportId: passport._id,
      action,
      status: result.status,
      ok: result.ok,
      error: result.error,
      argsPreview: previewArgs(args),
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
    const client = await loadClient(ctx);
    if (!client) {
      return htmlResponse(manifestForm(returnTo));
    }

    const redirectUri = oauthCallbackUrl();
    const state = crypto.randomUUID();
    await ctx.runMutation(internal.githubAuth.putOauthState, {
      state,
      returnTo,
    });

    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", state);
    if (client.slug === null) {
      authorize.searchParams.set("scope", GITHUB_OAUTH_SCOPES);
    }
    return Response.redirect(authorize.toString(), 302);
  }),
});

http.route({
  path: "/api/github/manifest",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const returnFallback = allowedReturnTo(null);
    const code = requestUrl.searchParams.get("code");
    if (typeof code !== "string") {
      return redirectTo(returnFallback, "error");
    }

    const converted = await fetch(
      `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    const raw: unknown = await converted.json();
    if (
      !isPlainObject(raw) ||
      typeof raw.client_id !== "string" ||
      typeof raw.client_secret !== "string" ||
      typeof raw.slug !== "string"
    ) {
      return redirectTo(returnFallback, "error");
    }

    const returnTo = allowedReturnTo(requestUrl.searchParams.get("state"));
    await ctx.runMutation(internal.githubAuth.saveAppCredentials, {
      clientId: raw.client_id,
      clientSecret: raw.client_secret,
      slug: raw.slug,
      pendingReturnTo: returnTo,
    });
    return Response.redirect(
      `https://github.com/apps/${encodeURIComponent(raw.slug)}/installations/new`,
      302,
    );
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
      return redirectTo(returnFallback, "error");
    }

    let origin: string | null = null;
    if (typeof state === "string") {
      origin = await ctx.runMutation(internal.githubAuth.consumeOauthState, {
        state,
      });
    }
    if (!origin) {
      origin = await ctx.runMutation(
        internal.githubAuth.consumePendingReturnTo,
        {},
      );
    }
    origin = origin ?? returnFallback;

    const client = await loadClient(ctx);
    if (!client) {
      return redirectTo(origin, "error");
    }

    const tokens = await exchangeOauthCode(client, code);
    if (!tokens) {
      return redirectTo(origin, "error");
    }
    const user = await githubLogin(tokens.accessToken);
    if (!user) {
      return redirectTo(origin, "error");
    }

    await ctx.runMutation(internal.githubAuth.saveConnection, {
      accessToken: tokens.accessToken,
      login: user.login,
      githubUserId: user.githubUserId,
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
