import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { exchangeAuthorizationCode, startAuthorize } from "../oauth";
import { providerForApp, type AppId } from "../domain/apps";
import { allowedReturnTo, redirectTo } from "./helpers";

export { parseBoardOrigin, resolveReturnTo } from "./helpers";

export function httpOAuthConnect(app: AppId) {
  const provider = providerForApp(app);
  return httpAction(async (ctx, request) => {
    const state = new URL(request.url).searchParams.get("state");
    if (!state) {
      return new Response("Missing OAuth state", { status: 400 });
    }
    const pending = await ctx.runQuery(
      internal.tables.oauthStates.queries.get,
      { state },
    );
    if (!pending || pending.app !== app) {
      return new Response("Invalid or expired OAuth state", { status: 400 });
    }
    const started = await startAuthorize(provider, state, app);
    if ("error" in started) {
      return new Response(started.error, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return Response.redirect(started.url, 302);
  });
}

export function httpOAuthCallback(app: AppId) {
  const provider = providerForApp(app);
  return httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const returnFallback = allowedReturnTo(null);
    const errorParam = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");

    if (errorParam) {
      return redirectTo(returnFallback, app, "denied");
    }
    if (typeof code !== "string") {
      return redirectTo(returnFallback, app, "error", "code");
    }
    if (typeof state !== "string") {
      return redirectTo(returnFallback, app, "error", "state");
    }
    const origin = await ctx.runMutation(
      internal.tables.oauthStates.mutations.consume,
      { state },
    );
    if (!origin || origin.app !== app) {
      return redirectTo(returnFallback, app, "error", "state");
    }

    let grant;
    try {
      grant = await exchangeAuthorizationCode(provider, code, state, app);
    } catch {
      return redirectTo(origin.returnTo, app, "error", "identity");
    }
    if ("error" in grant) {
      return redirectTo(origin.returnTo, app, "error", grant.error);
    }
    if (!grant.providerUserId.trim()) {
      return redirectTo(origin.returnTo, app, "error", "identity");
    }
    await ctx.runMutation(
      internal.tables.connections.mutations.saveConnection,
      {
        userId: origin.userId,
        provider,
        app,
        accessToken: grant.accessToken,
        login: grant.login,
        providerUserId: grant.providerUserId,
        refreshToken: grant.refreshToken,
        tokenExpiresAt: grant.tokenExpiresAt,
      },
    );
    return redirectTo(origin.returnTo, app, "connected");
  });
}
