import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { env } from "../_generated/server";
import { isAppId, type AppId } from "../domain/apps";
import { readObjectBody, requiredString } from "../lib/requests";
import { errorResponse, jsonResponse } from "../lib/responses";
import { parseBoardOrigin } from "./helpers";

function approvalUrlFor(publicToken: string): string {
  const origin = parseBoardOrigin(env.BOARD_ORIGIN);
  return `${origin}/approvals/${publicToken}`;
}

function readApps(body: Record<string, unknown>): AppId[] | Response {
  const raw = body.apps;
  if (!Array.isArray(raw) || raw.length === 0) {
    return errorResponse(400, "apps must be a non-empty array", "INVALID_REQUEST");
  }
  const apps: AppId[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isAppId(item)) {
      return errorResponse(400, "apps contains an unknown app", "INVALID_REQUEST");
    }
    apps.push(item);
  }
  return apps;
}

function readTtlMs(body: Record<string, unknown>): number | Response {
  const value = body.ttlMs;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return errorResponse(400, "ttlMs must be a number", "INVALID_REQUEST");
  }
  return value;
}

export const httpCreateAccessRequestHandler = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) {
    return body;
  }
  const agentName = requiredString(body, "agentName");
  if (agentName instanceof Response) {
    return agentName;
  }
  const apps = readApps(body);
  if (apps instanceof Response) {
    return apps;
  }
  const ttlMs = readTtlMs(body);
  if (ttlMs instanceof Response) {
    return ttlMs;
  }
  if (body.reason !== undefined && typeof body.reason !== "string") {
    return errorResponse(400, "reason must be a string", "INVALID_REQUEST");
  }
  const reason =
    typeof body.reason === "string" ? body.reason : undefined;

  const created = await ctx.runMutation(
    internal.tables.slices.onboardingAccess.createOnboarding,
    { agentName, apps, ttlMs, reason },
  );
  if (!created.ok) {
    return errorResponse(created.status, created.reason, created.code);
  }

  const approvalUrl = approvalUrlFor(created.publicToken);
  return jsonResponse(201, {
    requestId: created.requestId,
    status: created.status,
    expiresAt: created.expiresAt,
    agentName: created.agentName,
    apps: created.apps,
    ttlMs: created.ttlMs,
    reason: created.reason,
    // Chat-safe: share only this board URL with the user.
    approvalUrl,
    // Runtime-only: never paste claimHandle into chat.
    claimHandle: created.claimHandle,
  });
});

export const httpAccessRequestStatusHandler = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) {
    return body;
  }
  const claimHandle = requiredString(body, "claimHandle");
  if (claimHandle instanceof Response) {
    return claimHandle;
  }

  const status = await ctx.runMutation(
    internal.tables.slices.onboardingAccess.resolveOnboardingStatus,
    { claimHandle },
  );
  if (!status.ok) {
    return errorResponse(status.status, status.reason, status.code);
  }

  return jsonResponse(200, {
    requestId: status.requestId,
    status: status.status,
    expiresAt: status.expiresAt,
    agentName: status.agentName,
    apps: status.apps,
    ttlMs: status.ttlMs,
    reason: status.reason,
    approvalUrl: approvalUrlFor(status.publicToken),
  });
});

export const httpAccessRequestClaimHandler = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) {
    return body;
  }
  const claimHandle = requiredString(body, "claimHandle");
  if (claimHandle instanceof Response) {
    return claimHandle;
  }

  const decision = await ctx.runMutation(
    internal.tables.slices.onboardingAccess.resolveOnboardingClaim,
    { claimHandle },
  );
  if (!decision.ok) {
    return errorResponse(decision.status, decision.reason, decision.code);
  }

  if (decision.kind === "pending") {
    return jsonResponse(202, {
      error: "Operator approval required before slice credentials can be claimed",
      code: "APPROVAL_REQUIRED",
      requestId: decision.requestId,
      status: decision.status,
      expiresAt: decision.expiresAt,
      agentName: decision.agentName,
      apps: decision.apps,
      approvalUrl: approvalUrlFor(decision.publicToken),
    });
  }

  return jsonResponse(200, {
    requestId: decision.requestId,
    sliceId: decision.sliceId,
    sliceToken: decision.sliceToken,
    sliceSecret: decision.sliceSecret,
    expiresAt: decision.expiresAt,
    name: decision.name,
    apps: decision.apps,
    mintPolicy: decision.mintPolicy,
  });
});
