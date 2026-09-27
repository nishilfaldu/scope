import type { GenericActionCtx } from "convex/server";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import {
  refreshProviderTokens,
  type ConnectionSecrets,
  type RefreshedTokens,
} from "./index";
import {
  providerForApp,
  isGoogleApp,
  googleScopesAreBounded,
  type AppId,
} from "../domain/apps";
import type { AgentErrorCode } from "../lib/errors";

async function persistRefresh(
  ctx: GenericActionCtx<DataModel>,
  userId: Id<"users">,
  app: AppId,
  connectionId: Id<"connections">,
  connection: ConnectionSecrets,
  refreshed: RefreshedTokens,
  lease: string,
): Promise<boolean> {
  return await ctx.runMutation(
    internal.tables.connections.mutations.refreshConnection,
    {
      userId,
      app,
      connectionId,
      accessToken: refreshed.accessToken,
      providerUserId: connection.providerUserId,
      refreshToken:
        refreshed.refreshToken ?? connection.refreshToken ?? undefined,
      tokenExpiresAt:
        refreshed.tokenExpiresAt ?? connection.tokenExpiresAt ?? undefined,
      grantedScopes: refreshed.grantedScopes,
      grantVersion: connection.grantVersion,
      lease: lease,
    },
  );
}

export type IssueShortLivedAccessResult =
  | { accessToken: string; expiresAt: number | null; grantedScopes?: string[] }
  | { error: string; code: AgentErrorCode };

const SHORT_LIVED_UNAVAILABLE_RESULT = {
  error:
    "Provider cannot mint a short-lived access token for agents. Reconnect with a refresh-capable OAuth grant, or this provider hard-fails standing-token handoff.",
  code: "SHORT_LIVED_UNAVAILABLE" as const satisfies AgentErrorCode,
};

/**
 * Mint a provider-native short-lived access token for an agent.
 *
 * Never returns `connection.accessToken` or `connection.refreshToken`.
 * Refresh secrets stay in the vault; agents only receive a freshly minted
 * access token that differs from the stored standing upstream token.
 * Providers that cannot mint (standing-only user tokens, missing refresh)
 * hard-fail with SHORT_LIVED_UNAVAILABLE.
 */
export async function issueShortLivedAccess(
  ctx: GenericActionCtx<DataModel>,
  userId: Id<"users">,
  app: AppId,
  connectionId: Id<"connections">,
  delivery: "agent" | "server" = "agent",
): Promise<IssueShortLivedAccessResult> {
  const connection = await ctx.runQuery(
    internal.tables.connections.queries.getConnection,
    {
      userId,
      app,
      connectionId,
    },
  );
  if (!connection) {
    return {
      error: `${app} is not connected`,
      code: "APP_UNAVAILABLE",
    };
  }

  if (
    isGoogleApp(app) &&
    !googleScopesAreBounded(app, connection.grantedScopes)
  ) {
    return {
      error:
        "Google grant scopes are unknown or mismatched; reconnect the account",
      code: "APP_UNAVAILABLE",
    };
  }

  // A durable lease serializes rotating refresh tokens across Convex actions.
  const lease = crypto.randomUUID();
  const acquired = await ctx.runMutation(
    internal.tables.connections.mutations.beginRefresh,
    {
      userId,
      app,
      connectionId,
      grantVersion: connection.grantVersion,
      lease,
    },
  );
  if (!acquired)
    return {
      error: "Connection refresh is in progress; retry shortly",
      code: "PROVIDER_ERROR",
    };
  let minted: RefreshedTokens | null;
  try {
    minted = await refreshProviderTokens(providerForApp(app), connection);
  } catch {
    await ctx.runMutation(
      internal.tables.connections.mutations.releaseRefresh,
      { connectionId, lease },
    );
    return SHORT_LIVED_UNAVAILABLE_RESULT;
  }
  if (!minted) {
    await ctx.runMutation(
      internal.tables.connections.mutations.releaseRefresh,
      { connectionId, lease },
    );
    return SHORT_LIVED_UNAVAILABLE_RESULT;
  }

  // A broker may reuse a provider token because it never gives that token to
  // the agent. Direct handoff must still refuse the stored access token.
  if (
    (delivery === "agent" && minted.accessToken === connection.accessToken) ||
    (connection.refreshToken !== null &&
      minted.accessToken === connection.refreshToken)
  ) {
    await ctx.runMutation(
      internal.tables.connections.mutations.releaseRefresh,
      { connectionId, lease },
    );
    return {
      error: "Refusing to hand off the vault standing upstream token to agents",
      code: "SHORT_LIVED_UNAVAILABLE",
    };
  }

  if (
    !(await persistRefresh(
      ctx,
      userId,
      app,
      connectionId,
      connection,
      minted,
      lease,
    ))
  ) {
    return { error: `${app} is not connected`, code: "APP_UNAVAILABLE" };
  }

  if (
    isGoogleApp(app) &&
    !googleScopesAreBounded(
      app,
      minted.grantedScopes ?? connection.grantedScopes,
    )
  ) {
    return {
      error: "Google grant scopes do not match this app; reconnect the account",
      code: "APP_UNAVAILABLE",
    };
  }

  // The provider controls this token's lifetime. We cannot shorten it by
  // reporting an earlier expiry to the agent.
  const expiresAt = minted.tokenExpiresAt ?? null;
  // Intentionally omit refreshToken — agents never receive vault refresh secrets.
  return {
    accessToken: minted.accessToken,
    expiresAt,
    // Google can omit scope on refresh. The connection's verified grant is the
    // effective scope only when the refresh response did not report one.
    grantedScopes:
      minted.grantedScopes ??
      (isGoogleApp(app) ? connection.grantedScopes : undefined),
  };
}
