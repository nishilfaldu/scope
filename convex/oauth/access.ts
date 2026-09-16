import type { GenericActionCtx } from "convex/server";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import {
  refreshProviderTokens,
  type ConnectionSecrets,
  type RefreshedTokens,
} from "./index";
import type { ProviderId } from "../domain/apps";
import type { AgentErrorCode } from "../lib/errors";
import { APP_TOKEN_TTL_MS } from "../tables/slices/credentials";

function secretsChanged(
  connection: ConnectionSecrets,
  refreshed: RefreshedTokens,
): boolean {
  const refreshToken = refreshed.refreshToken ?? connection.refreshToken;
  const tokenExpiresAt = refreshed.tokenExpiresAt ?? connection.tokenExpiresAt;
  return (
    refreshed.accessToken !== connection.accessToken ||
    refreshToken !== connection.refreshToken ||
    tokenExpiresAt !== connection.tokenExpiresAt
  );
}

async function persistIfChanged(
  ctx: GenericActionCtx<DataModel>,
  userId: Id<"users">,
  provider: ProviderId,
  connection: ConnectionSecrets,
  refreshed: RefreshedTokens,
): Promise<void> {
  if (!secretsChanged(connection, refreshed)) {
    return;
  }
  await ctx.runMutation(internal.tables.connections.mutations.saveConnection, {
    userId,
    provider,
    accessToken: refreshed.accessToken,
    login: connection.login,
    providerUserId: connection.providerUserId,
    refreshToken:
      refreshed.refreshToken ?? connection.refreshToken ?? undefined,
    tokenExpiresAt:
      refreshed.tokenExpiresAt ?? connection.tokenExpiresAt ?? undefined,
  });
}

export type IssueShortLivedAccessResult =
  | { accessToken: string; expiresAt: number }
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
  provider: ProviderId,
): Promise<IssueShortLivedAccessResult> {
  const connection = await ctx.runQuery(
    internal.tables.connections.queries.getConnection,
    {
      userId,
      provider,
    },
  );
  if (!connection) {
    return {
      error: `${provider} is not connected`,
      code: "APP_UNAVAILABLE",
    };
  }

  let minted: RefreshedTokens | null;
  try {
    minted = await refreshProviderTokens(provider, connection);
  } catch {
    // Network / malformed / unexpected refresh failures must not become 500s.
    return SHORT_LIVED_UNAVAILABLE_RESULT;
  }
  if (!minted) {
    return SHORT_LIVED_UNAVAILABLE_RESULT;
  }

  // Refuse vault standing-token handoff even if a provider regresses.
  if (
    minted.accessToken === connection.accessToken ||
    (connection.refreshToken !== null &&
      minted.accessToken === connection.refreshToken)
  ) {
    return {
      error:
        "Refusing to hand off the vault standing upstream token to agents",
      code: "SHORT_LIVED_UNAVAILABLE",
    };
  }

  await persistIfChanged(ctx, userId, provider, connection, minted);

  const providerExpiry = minted.tokenExpiresAt ?? connection.tokenExpiresAt;
  const expiresAt = Math.min(
    Date.now() + APP_TOKEN_TTL_MS,
    providerExpiry ?? Date.now() + APP_TOKEN_TTL_MS,
  );
  // Intentionally omit refreshToken — agents never receive vault refresh secrets.
  return { accessToken: minted.accessToken, expiresAt };
}
