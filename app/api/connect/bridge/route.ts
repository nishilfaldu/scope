import {
  getConnectorMetadata,
  getTokenResponse,
  revokeToken,
  startAuthorization,
} from "@vercel/connect";
import { timingSafeEqual } from "node:crypto";
import {
  CONNECT_SLACK_SCOPES,
  isRotatingSlackUserToken,
  slackScopesAreBounded,
  slackExpiryIsBounded,
} from "@/convex/connect/contracts";
import { isPlainObject } from "@/convex/lib/json";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const fail = (status: number) =>
  Response.json(
    { error: "Connect request unavailable" },
    { status, headers: noStore },
  );
function authenticated(request: Request, secret: string) {
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(request: Request) {
  const secret = process.env.CONNECT_BRIDGE_SECRET;
  if (!secret || !authenticated(request, secret)) return fail(401);
  const connector = process.env.CONNECT_SLACK_CONNECTOR;
  const site = process.env.SCOPE_CONVEX_SITE_URL;
  const board = process.env.SCOPE_BOARD_ORIGIN;
  if (!connector || !site || !board) return fail(503);
  try {
    const body: unknown = await request.json();
    if (
      !isPlainObject(body) ||
      Object.keys(body).length !== 1 ||
      typeof body.ticket !== "string" ||
      !/^cb_[a-f0-9]{64}$/.test(body.ticket)
    )
      return fail(400);
    const siteUrl = new URL(site);
    if (
      siteUrl.protocol !== "https:" ||
      siteUrl.pathname !== "/" ||
      siteUrl.search ||
      siteUrl.hash ||
      siteUrl.username ||
      siteUrl.password
    )
      return fail(503);
    const resolved = await fetch(new URL("/api/connect/ticket", siteUrl), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!resolved.ok) return fail(403);
    const command: unknown = await resolved.json();
    if (!isPlainObject(command)) return fail(403);
    const reference =
      command.operation === "revoke" ? command.reference : command;
    if (
      !isPlainObject(reference) ||
      typeof reference.subjectId !== "string" ||
      !reference.subjectId.startsWith("scope:") ||
      reference.issuer !== siteUrl.origin
    )
      return fail(403);
    if (
      command.operation !== "authorize" &&
      command.operation !== "token" &&
      command.operation !== "revoke"
    )
      return fail(403);
    const subject = {
      type: "user" as const,
      id: reference.subjectId,
      issuer: siteUrl.origin,
    };

    const metadata = await getConnectorMetadata(connector);
    if (
      metadata.type !== "slack" ||
      !["slack", "slack.com"].includes(metadata.service)
    )
      return fail(503);
    if (
      reference.connectorId !== undefined &&
      reference.connectorId !== metadata.id
    )
      return fail(403);
    if (
      reference.installationId !== undefined &&
      (typeof reference.installationId !== "string" ||
        !reference.installationId ||
        reference.installationId === "*")
    )
      return fail(403);
    const installationId =
      typeof reference.installationId === "string"
        ? reference.installationId
        : undefined;
    if (command.operation === "revoke") {
      if (!installationId || !reference.connectorId) return fail(403);
      await revokeToken(metadata.id, { subject, installationId });
      return Response.json({ ok: true }, { headers: noStore });
    }
    const params = { subject, installationId, scopes: CONNECT_SLACK_SCOPES };
    if (command.operation === "authorize") {
      if (
        typeof command.state !== "string" ||
        !/^[a-f0-9-]{36}$/.test(command.state)
      )
        return fail(403);
      const callback = new URL("/oauth/complete", board);
      callback.searchParams.set("app", "slack");
      callback.searchParams.set("state", command.state);

      callback.searchParams.set("code", "connect");
      const result = await startAuthorization(metadata.id, params, {
        callbackUrl: callback.toString(),
        expiresInMs: 600_000,
      });
      if (new URL(result.url).protocol !== "https:") return fail(503);
      return Response.json({ url: result.url }, { headers: noStore });
    }
    const token = await getTokenResponse(metadata.id, params, {
      forceRefresh: true,
    });
    if (
      token.connector.id !== metadata.id ||
      token.connector.type !== "slack" ||
      !token.installationId ||
      token.installationId === "*" ||
      (installationId && token.installationId !== installationId)
    ) {
      console.warn("Slack Connect account reference rejected", {
        connectorMatches: token.connector.id === metadata.id,
        slackConnector: token.connector.type === "slack",
        installationPresent: Boolean(token.installationId),
        installationMatches:
          !installationId || token.installationId === installationId,
      });
      return fail(403);
    }
    if (
      !isRotatingSlackUserToken(token.token) ||
      !slackExpiryIsBounded(token.expiresAt)
    ) {
      console.warn("Slack Connect credential rejected", {
        rotatingUser: isRotatingSlackUserToken(token.token),
        unrotatedUser:
          typeof token.token === "string" && token.token.startsWith("xoxp-"),
        boundedExpiry: slackExpiryIsBounded(token.expiresAt),
      });
      return fail(503);
    }
    const identityResponse = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const identity: unknown = await identityResponse.json();
    const scopes = (identityResponse.headers.get("x-oauth-scopes") ?? "")
      .split(/[,\s]+/)
      .filter(Boolean);
    if (
      !identityResponse.ok ||
      !isPlainObject(identity) ||
      identity.ok !== true ||
      identity.bot_id ||
      typeof identity.team_id !== "string" ||
      !identity.team_id ||
      typeof identity.user_id !== "string" ||
      !identity.user_id ||
      !slackScopesAreBounded(scopes)
    ) {
      console.warn("Slack Connect identity rejected", {
        providerOk:
          identityResponse.ok &&
          isPlainObject(identity) &&
          identity.ok === true,
        userIdentity:
          isPlainObject(identity) &&
          !identity.bot_id &&
          typeof identity.team_id === "string" &&
          typeof identity.user_id === "string",
        boundedScopes: slackScopesAreBounded(scopes),
        grantedScopes: scopes,
      });
      return fail(403);
    }
    if (
      (token.tenantId !== undefined && token.tenantId !== identity.team_id) ||
      (token.externalSubject !== undefined &&
        token.externalSubject !== identity.user_id)
    ) {
      console.warn("Slack Connect provider subject rejected", {
        tenantMatches:
          token.tenantId === undefined || token.tenantId === identity.team_id,
        subjectMatches:
          token.externalSubject === undefined ||
          token.externalSubject === identity.user_id,
      });
      return fail(403);
    }
    const providerUserId = `${identity.team_id}:${identity.user_id}`;
    if (
      command.providerUserId !== undefined &&
      command.providerUserId !== providerUserId
    )
      return fail(403);
    return Response.json(
      {
        accessToken: token.token,
        expiresAt: token.expiresAt,
        providerUserId,
        login: `${typeof identity.user === "string" ? identity.user : identity.user_id} (${typeof identity.team === "string" ? identity.team : identity.team_id})`,
        connectorId: metadata.id,
        installationId: token.installationId,
        grantedScopes: scopes,
      },
      { headers: noStore },
    );
  } catch {
    return fail(503);
  }
}
