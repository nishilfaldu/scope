import { getAuthUserId } from "@convex-dev/auth/server";
import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { exchangeAuthorizationCode, startAuthorize } from "../oauth";
import type { ProviderId } from "../domain/apps";
import { allowedReturnTo, redirectTo } from "./helpers";

export { parseBoardOrigin, resolveReturnTo } from "./helpers";

export function httpOAuthConnect(provider: ProviderId) {
  return httpAction(async (ctx, request) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return new Response("Sign in to continue", { status: 401 });
    }
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
      userId,
      provider,
      state,
      returnTo,
    });
    return Response.redirect(started.url, 302);
  });
}

export function httpOAuthCallback(provider: ProviderId) {
  return httpAction(async (ctx, request) => {
    const userId = await getAuthUserId(ctx);
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
    if (!origin || origin.provider !== provider || origin.userId !== userId) {
      return redirectTo(returnFallback, provider, "error", "state");
    }

    const grant = await exchangeAuthorizationCode(provider, code);
    if ("error" in grant) {
      return redirectTo(origin.returnTo, provider, "error", grant.error);
    }
    await ctx.runMutation(
      internal.tables.connections.mutations.saveConnection,
      {
        userId: origin.userId,
        provider,
        accessToken: grant.accessToken,
        login: grant.login,
        providerUserId: grant.providerUserId,
        refreshToken: grant.refreshToken,
        tokenExpiresAt: grant.tokenExpiresAt,
      },
    );
    return redirectTo(origin.returnTo, provider, "connected");
  });
}
