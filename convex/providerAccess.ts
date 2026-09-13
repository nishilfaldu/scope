import type { GenericActionCtx } from "convex/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  refreshProviderTokens,
  type ConnectionSecrets,
  type RefreshedTokens,
} from "./oauth";
import type { ProviderId } from "./permissions";
import { PLATFORM_TOKEN_TTL_MS } from "./tokens";

function secretsChanged(
  connection: ConnectionSecrets,
  refreshed: RefreshedTokens,
): boolean {
  const refreshToken = refreshed.refreshToken ?? connection.refreshToken;
  const tokenExpiresAt =
    refreshed.tokenExpiresAt ?? connection.tokenExpiresAt;
  return (
    refreshed.accessToken !== connection.accessToken ||
    refreshToken !== connection.refreshToken ||
    tokenExpiresAt !== connection.tokenExpiresAt
  );
}

async function persistIfChanged(
  ctx: GenericActionCtx<DataModel>,
  provider: ProviderId,
  connection: ConnectionSecrets,
  refreshed: RefreshedTokens,
): Promise<void> {
  if (!secretsChanged(connection, refreshed)) {
    return;
  }
  await ctx.runMutation(internal.connections.saveConnection, {
    provider,
    accessToken: refreshed.accessToken,
    login: connection.login,
    providerUserId: connection.providerUserId,
    refreshToken: refreshed.refreshToken ?? connection.refreshToken ?? undefined,
    tokenExpiresAt:
      refreshed.tokenExpiresAt ?? connection.tokenExpiresAt ?? undefined,
  });
}

export async function issueShortLivedAccess(
  ctx: GenericActionCtx<DataModel>,
  provider: ProviderId,
): Promise<{ accessToken: string; expiresAt: number } | { error: string }> {
  const connection = await ctx.runQuery(internal.connections.getConnection, {
    provider,
  });
  if (!connection) {
    return { error: `${provider} is not connected` };
  }
  const refreshed = await refreshProviderTokens(provider, connection);
  if (!refreshed) {
    return { error: "Could not refresh platform token" };
  }
  await persistIfChanged(ctx, provider, connection, refreshed);
  const providerExpiry = refreshed.tokenExpiresAt ?? connection.tokenExpiresAt;
  const expiresAt = Math.min(
    Date.now() + PLATFORM_TOKEN_TTL_MS,
    providerExpiry ?? Date.now() + PLATFORM_TOKEN_TTL_MS,
  );
  return { accessToken: refreshed.accessToken, expiresAt };
}
