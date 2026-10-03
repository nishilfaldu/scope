import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { callBridge } from "./bridge";
import {
  isRotatingSlackUserToken,
  slackScopesAreBounded,
  slackExpiryIsBounded,
} from "./contracts";
import type { AgentErrorCode } from "../lib/errors";

type IssueConnectAccessResult =
  | { accessToken: string; expiresAt: number; connectionGrantVersion: number }
  | { error: string; code: AgentErrorCode };

export function verifiedGrant(raw: Record<string, unknown>) {
  if (
    !isRotatingSlackUserToken(raw.accessToken) ||
    !slackExpiryIsBounded(raw.expiresAt) ||
    typeof raw.providerUserId !== "string" ||
    !/^[^:]+:[^:]+$/.test(raw.providerUserId) ||
    typeof raw.login !== "string" ||
    typeof raw.connectorId !== "string" ||
    !raw.connectorId ||
    typeof raw.installationId !== "string" ||
    !raw.installationId ||
    raw.installationId === "*" ||
    !slackScopesAreBounded(raw.grantedScopes)
  )
    throw new Error("Invalid Slack Connect grant");
  return {
    accessToken: raw.accessToken,
    expiresAt: raw.expiresAt,
    providerUserId: raw.providerUserId,
    login: raw.login,
    connectorId: raw.connectorId,
    installationId: raw.installationId,
    grantedScopes: raw.grantedScopes,
  };
}
export async function issueConnectAccess(
  ctx: ActionCtx,
  userId: Id<"users">,
  connectionId: Id<"connections">,
): Promise<IssueConnectAccessResult> {
  const connection = await ctx.runQuery(internal.connect.connections.get, {
    userId,
    connectionId,
  });
  if (!connection)
    return { error: "Slack is not connected", code: "APP_UNAVAILABLE" };
  try {
    const raw = await callBridge(ctx, {
      operation: "token",
      ...connection.connect,
      providerUserId: connection.providerUserId,
    });
    const grant = verifiedGrant(raw);
    const current = await ctx.runQuery(internal.connect.connections.get, {
      userId,
      connectionId,
    });
    if (
      !current ||
      current.grantVersion !== connection.grantVersion ||
      grant.connectorId !== connection.connect.connectorId ||
      grant.installationId !== connection.connect.installationId ||
      grant.providerUserId !== connection.providerUserId
    )
      return {
        error: "Slack account changed or disconnected",
        code: "APP_UNAVAILABLE",
      };
    return {
      accessToken: grant.accessToken,
      expiresAt: grant.expiresAt,
      connectionGrantVersion: current.grantVersion,
    };
  } catch {
    return {
      error:
        "Slack Connect cannot issue a bounded user credential. Reconnect or check connector configuration.",
      code: "SHORT_LIVED_UNAVAILABLE",
    };
  }
}
