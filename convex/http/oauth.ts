import { env, httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { exchangeAuthorizationCode, startAuthorize } from "../oauth";
import type { ProviderId } from "../permissions";

const ALLOWED_RETURN_PATHS = new Set(["/", "/connections"]);

export function parseBoardOrigin(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("BOARD_ORIGIN must use http or https");
    }
    return url.origin;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BOARD_ORIGIN")) {
      throw error;
    }
    throw new Error("BOARD_ORIGIN must be a valid http(s) origin");
  }
}

export function resolveReturnTo(
  value: string | null,
  boardOrigin: string,
): string {
  const fallback = `${boardOrigin}/connections`;
  if (!value) {
    return fallback;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallback;
    }
    if (url.origin !== boardOrigin) {
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
