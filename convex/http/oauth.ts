import { env, httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { startAuthorize } from "../oauth";
import { callBridge } from "../connect/bridge";
import { providerForApp, type AppId } from "../domain/apps";

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
    if (pending.connectSubjectId) {
      if (app !== "slack") return new Response(null, { status: 400 });
      try {
        const result = await callBridge(ctx, {
          operation: "authorize",
          subjectId: pending.connectSubjectId,
          issuer: env.CONVEX_SITE_URL,
          state,
        });
        if (typeof result.url !== "string")
          throw new Error("Missing authorization URL");
        return Response.redirect(result.url, 302);
      } catch {
        return new Response("Slack Connect is unavailable", { status: 503 });
      }
    }
    const started = await startAuthorize(
      provider,
      state,
      app,
      pending.pkceChallenge,
    );
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
  return httpAction(async (_ctx, request) => {
    const incoming = new URL(request.url);
    const target = new URL("/oauth/complete", env.BOARD_ORIGIN);
    target.searchParams.set("app", app);
    for (const key of ["state", "code", "error"]) {
      const value = incoming.searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    }
    return Response.redirect(target.toString(), 302);
  });
}
