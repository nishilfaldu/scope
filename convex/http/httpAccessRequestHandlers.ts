import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { env } from "../_generated/server";
import { isAppId, type AppId } from "../domain/apps";
import {
  readObjectBody,
  requiredHeader,
  requiredString,
} from "../lib/requests";
import { errorResponse, jsonResponse } from "../lib/responses";
import { AGENT_ERROR_GUIDANCE } from "../lib/errors";
import { parseBoardOrigin } from "../domain/returnPaths";

function approvalUrlFor(publicToken: string): string {
  const origin = parseBoardOrigin(env.BOARD_ORIGIN);
  return `${origin}/requests/new/${publicToken}`;
}

function readApps(body: Record<string, unknown>): AppId[] | Response {
  const raw = body.apps;
  if (!Array.isArray(raw) || raw.length === 0) {
    return errorResponse(
      400,
      "apps must be a non-empty array",
      "INVALID_REQUEST",
    );
  }
  const apps: AppId[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isAppId(item)) {
      return errorResponse(
        400,
        "apps contains an unknown app",
        "INVALID_REQUEST",
      );
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

export const httpCreateAccessRequestHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) {
      return body;
    }
    const agentConnectionId = requiredHeader(request, "x-agent-connection-id");
    if (agentConnectionId instanceof Response) return agentConnectionId;
    const agentConnectionSecret = requiredHeader(
      request,
      "x-agent-connection-secret",
    );
    if (agentConnectionSecret instanceof Response) return agentConnectionSecret;
    const apps = readApps(body);
    if (apps instanceof Response) {
      return apps;
    }
    const ttlMs = readTtlMs(body);
    if (ttlMs instanceof Response) {
      return ttlMs;
    }
    const reason = requiredString(body, "reason");
    if (reason instanceof Response) return reason;
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (
      idempotencyKey !== undefined &&
      (idempotencyKey.length < 32 || idempotencyKey.length > 128)
    ) {
      return errorResponse(
        400,
        "Idempotency-Key must be 32 to 128 characters",
        "INVALID_REQUEST",
      );
    }

    const created = await ctx.runMutation(
      internal.tables.slices.sliceRequestClaims.createSliceRequest,
      {
        agentConnectionId,
        agentConnectionSecret,
        apps,
        ttlMs,
        reason,
        idempotencyKey,
      },
    );
    if (!created.ok) {
      return errorResponse(
        created.status,
        created.reason,
        created.code,
        created,
      );
    }

    const approvalUrl = approvalUrlFor(created.publicToken);
    return jsonResponse(created.reused ? 200 : 201, {
      requestId: created.requestId,
      status: created.status,
      approvalDeadlineAt: created.approvalDeadlineAt,
      serverTime: Date.now(),
      agentName: created.agentName,
      apps: created.apps,
      ttlMs: created.ttlMs,
      reason: created.reason,

      approvalUrl,

      claimHandle: created.claimHandle,
      reused: created.reused,
      nextAction: {
        type: "share_approval_url_then_poll",
        method: "POST",
        path: "/api/access-requests/status",
        requiredBodyFields: ["claimHandle"],
      },
    });
  },
);

export const httpAccessRequestStatusHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) {
      return body;
    }
    const claimHandle = requiredString(body, "claimHandle");
    if (claimHandle instanceof Response) {
      return claimHandle;
    }

    const now = Date.now();
    const status = await ctx.runQuery(
      internal.tables.slices.sliceRequestClaims.resolveSliceRequestStatus,
      { claimHandle, now },
    );
    if (!status.ok) {
      return errorResponse(status.status, status.reason, status.code, status);
    }

    return jsonResponse(200, {
      requestId: status.requestId,
      status: status.status,
      approvalDeadlineAt: status.approvalDeadlineAt,
      pickupDeadlineAt: status.pickupDeadlineAt,
      ackDeadlineAt: status.ackDeadlineAt,
      sliceExpiresAt: status.sliceExpiresAt,
      handoffStatus: status.handoffStatus,
      resourceStatus: status.resourceStatus,
      acknowledgedAt: status.acknowledgedAt,
      reasonCode: status.reasonCode,
      serverTime: now,
      nextAction:
        status.handoffStatus === "waiting_for_approval"
          ? {
              type: "poll_status",
              method: "POST",
              path: "/api/access-requests/status",
              requiredBodyFields: ["claimHandle"],
            }
          : status.handoffStatus === "waiting_for_pickup"
            ? {
                type: "claim",
                method: "POST",
                path: "/api/access-requests/claim",
                requiredBodyFields: ["claimHandle"],
              }
            : status.handoffStatus === "waiting_for_ack"
              ? {
                  type: "persist_then_ack",
                  method: "POST",
                  path: "/api/access-requests/ack",
                  requiredBodyFields: ["claimHandle", "sliceSecret"],
                }
              : status.handoffStatus === "ready"
                ? { type: "use_slice" }
                : { type: "stop_and_request_new_grant" },
      agentName: status.agentName,
      apps: status.apps,
      ttlMs: status.ttlMs,
      reason: status.reason,
      approvalUrl: approvalUrlFor(status.publicToken),
    });
  },
);

export const httpAccessRequestClaimHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) {
      return body;
    }
    const claimHandle = requiredString(body, "claimHandle");
    if (claimHandle instanceof Response) {
      return claimHandle;
    }

    const decision = await ctx.runMutation(
      internal.tables.slices.sliceRequestClaims.resolveSliceRequestClaim,
      { claimHandle },
    );
    if (!decision.ok) {
      return errorResponse(
        decision.status,
        decision.reason,
        decision.code,
        decision,
      );
    }

    if (decision.kind === "pending") {
      return jsonResponse(202, {
        error:
          "Operator approval required before slice credentials can be claimed",
        code: "APPROVAL_REQUIRED",
        ...AGENT_ERROR_GUIDANCE.APPROVAL_REQUIRED,
        requestId: decision.requestId,
        status: decision.status,
        approvalDeadlineAt: decision.approvalDeadlineAt,
        serverTime: Date.now(),
        nextAction: {
          type: "poll_status",
          method: "POST",
          path: "/api/access-requests/status",
          requiredBodyFields: ["claimHandle"],
        },
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
      sliceExpiresAt: decision.sliceExpiresAt,
      ackDeadlineAt: decision.ackDeadlineAt,
      ackRequired: decision.ackRequired,
      handoffStatus: "awaiting_ack",
      serverTime: Date.now(),
      nextAction: {
        type: "persist_then_ack",
        method: "POST",
        path: "/api/access-requests/ack",
        requiredBodyFields: ["claimHandle", "sliceSecret"],
      },
      name: decision.name,
      apps: decision.apps,
      mintPolicy: decision.mintPolicy,
    });
  },
);

export const httpCancelAccessRequestHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const claimHandle = requiredString(body, "claimHandle");
    if (claimHandle instanceof Response) return claimHandle;
    const agentConnectionId = requiredHeader(request, "x-agent-connection-id");
    if (agentConnectionId instanceof Response) return agentConnectionId;
    const agentConnectionSecret = requiredHeader(
      request,
      "x-agent-connection-secret",
    );
    if (agentConnectionSecret instanceof Response) return agentConnectionSecret;
    const cancelled = await ctx.runMutation(
      internal.tables.slices.sliceRequestClaims.cancelSliceRequest,
      { agentConnectionId, agentConnectionSecret, claimHandle },
    );
    if (!cancelled) {
      return errorResponse(
        409,
        "Slice request cannot be cancelled",
        "INVALID_REQUEST",
      );
    }
    return jsonResponse(200, { status: "cancelled" });
  },
);

export const httpAccessRequestAckHandler = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) return body;
  const claimHandle = requiredString(body, "claimHandle");
  if (claimHandle instanceof Response) return claimHandle;
  const sliceSecret = requiredString(body, "sliceSecret");
  if (sliceSecret instanceof Response) return sliceSecret;
  const ok = await ctx.runMutation(
    internal.tables.slices.sliceRequestClaims.acknowledgeSliceClaim,
    { claimHandle, sliceSecret },
  );
  return ok.ok
    ? jsonResponse(200, {
        ...ok,
        handoffStatus:
          ok.resourceStatus === "active" ? "ready" : ok.resourceStatus,
        serverTime: Date.now(),
      })
    : errorResponse(ok.status, ok.reason, ok.code, ok);
});
