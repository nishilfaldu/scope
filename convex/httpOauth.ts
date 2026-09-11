import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { exchangeAuthorizationCode, startAuthorize } from "./oauth";
import type { ProviderId } from "./permissions";

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
    await ctx.runMutation(internal.connections.putOauthState, {
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
      internal.connections.consumeOauthState,
      { state },
    );
    if (!origin || origin.provider !== provider) {
      return redirectTo(returnFallback, provider, "error", "state");
    }

    const grant = await exchangeAuthorizationCode(provider, code);
    if ("error" in grant) {
      return redirectTo(origin.returnTo, provider, "error", grant.error);
    }
    await ctx.runMutation(internal.connections.saveConnection, {
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
