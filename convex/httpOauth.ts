import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { exchangeAuthorizationCode, startAuthorize } from "./oauth";
import type { ProviderId } from "./permissions";

const ALLOWED_RETURN_PATHS = new Set(["/", "/connections"]);

export function parseBoardOrigin(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveReturnTo(
  value: string | null,
  boardOrigin: string | null,
): string {
  const fallbackOrigin = boardOrigin ?? "http://localhost:3000";
  const fallback = `${fallbackOrigin}/connections`;
  if (!value) {
    return fallback;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallback;
    }
    const local =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const configured = boardOrigin !== null && url.origin === boardOrigin;
    if (!local && !configured) {
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

function allowedReturnTo(value: string | null): string {
  return resolveReturnTo(value, parseBoardOrigin(env.BOARD_ORIGIN));
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

export function oauthConnect(provider: ProviderId) {
  return httpAction(async (ctx, request) => {
    const returnTo = allowedReturnTo(
      new URL(request.url).searchParams.get("returnTo"),
    );
    const state = crypto.randomUUID();
    const started = startAuthorize(provider, state);
    if ("error" in started) {
      return new Response(started.error, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    await ctx.runMutation(internal.tables.oauthStates.mutations.put, {
      provider,
      state,
      returnTo,
    });
    return Response.redirect(started.url, 302);
  });
}

export function oauthCallback(provider: ProviderId) {
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
      internal.tables.oauthStates.mutations.consume,
      { state },
    );
    if (!origin || origin.provider !== provider) {
      return redirectTo(returnFallback, provider, "error", "state");
    }

    const grant = await exchangeAuthorizationCode(provider, code);
    if ("error" in grant) {
      return redirectTo(origin.returnTo, provider, "error", grant.error);
    }
    await ctx.runMutation(internal.tables.connections.mutations.saveConnection, {
      provider,
      accessToken: grant.accessToken,
      login: grant.login,
      providerUserId: grant.providerUserId,
      refreshToken: grant.refreshToken,
      tokenExpiresAt: grant.tokenExpiresAt,
    });
    return redirectTo(origin.returnTo, provider, "connected");
  });
}
