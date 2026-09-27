import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { env, httpAction } from "../_generated/server";
import { parseBoardOrigin } from "../domain/returnPaths";
import {
  readObjectBody,
  requiredHeader,
  requiredString,
} from "../lib/requests";
import { errorResponse, jsonResponse } from "../lib/responses";
import { AGENT_ERROR_CODES, type AgentErrorCode } from "../lib/errors";

export const httpCreateAgentConnectionHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const previousConnectionId = request.headers
      .get("x-agent-connection-id")
      ?.trim();
    const previousConnectionSecret = request.headers
      .get("x-agent-connection-secret")
      ?.trim();
    if (
      (previousConnectionId === undefined) !==
      (previousConnectionSecret === undefined)
    ) {
      return errorResponse(
        400,
        "Previous connection ID and secret must be provided together",
        "INVALID_REQUEST",
      );
    }
    const agentName = typeof body.agentName === "string" ? body.agentName : "";
    if (!previousConnectionId && agentName.length === 0) {
      return errorResponse(
        400,
        "agentName must be a string",
        "INVALID_REQUEST",
      );
    }
    try {
      const created = await ctx.runMutation(
        internal.tables.agentConnections.createInvite,
        {
          agentName,
          previousConnectionId,
          previousConnectionSecret,
        },
      );
      return jsonResponse(201, {
        agentName: created.agentName,
        agentId: created.agentId,
        reconnecting: created.reconnecting,
        connectUrl:
          parseBoardOrigin(env.BOARD_ORIGIN) +
          "/connect/" +
          created.publicToken,
        claimHandle: created.claimHandle,
        approvalDeadlineAt: created.approvalDeadlineAt,
        serverTime: Date.now(),
        nextAction: {
          type: "share_approval_url_then_poll",
          method: "POST",
          path: "/api/agent-connections/status",
          requiredBodyFields: ["claimHandle"],
        },
      });
    } catch (error) {
      if (
        error instanceof ConvexError &&
        error.data &&
        typeof error.data === "object" &&
        "ok" in error.data &&
        error.data.ok === false &&
        "status" in error.data &&
        "reason" in error.data &&
        "code" in error.data &&
        typeof error.data.status === "number" &&
        typeof error.data.reason === "string" &&
        typeof error.data.code === "string" &&
        (AGENT_ERROR_CODES as readonly string[]).includes(error.data.code)
      ) {
        return errorResponse(
          error.data.status,
          error.data.reason,
          error.data.code as AgentErrorCode,
          error.data,
        );
      }
      return errorResponse(
        400,
        error instanceof Error ? error.message : "Invalid request",
        "INVALID_REQUEST",
      );
    }
  },
);

export const httpRevokeAgentConnectionHandler = httpAction(
  async (ctx, request) => {
    const agentConnectionId = requiredHeader(request, "x-agent-connection-id");
    if (agentConnectionId instanceof Response) return agentConnectionId;
    const agentConnectionSecret = requiredHeader(
      request,
      "x-agent-connection-secret",
    );
    if (agentConnectionSecret instanceof Response) return agentConnectionSecret;
    const result = await ctx.runMutation(
      internal.tables.agentConnections.revokeBySecret,
      { agentConnectionId, agentConnectionSecret },
    );
    if (!result.ok) {
      return errorResponse(401, "Invalid agent connection", "UNAUTHORIZED");
    }
    return jsonResponse(200, result);
  },
);

export const httpActivateAgentConnectionHandler = httpAction(
  async (ctx, request) => {
    const agentConnectionId = requiredHeader(request, "x-agent-connection-id");
    if (agentConnectionId instanceof Response) return agentConnectionId;
    const agentConnectionSecret = requiredHeader(
      request,
      "x-agent-connection-secret",
    );
    if (agentConnectionSecret instanceof Response) return agentConnectionSecret;
    const result = await ctx.runMutation(
      internal.tables.agentConnections.activateReplacement,
      { agentConnectionId, agentConnectionSecret },
    );
    if (!result.ok) {
      return errorResponse(result.status, result.reason, result.code, result);
    }
    return jsonResponse(200, {
      ...result,
      handoffStatus: result.status === "active" ? "ready" : "revoked",
      serverTime: Date.now(),
    });
  },
);

export const httpCancelAgentConnectionInviteHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const claimHandle = requiredString(body, "claimHandle");
    if (claimHandle instanceof Response) return claimHandle;
    const cancelled = await ctx.runMutation(
      internal.tables.agentConnections.cancelInvite,
      { claimHandle },
    );
    if (!cancelled) {
      return errorResponse(
        409,
        "Connection invite cannot be cancelled",
        "INVALID_REQUEST",
      );
    }
    return jsonResponse(200, { status: "cancelled" });
  },
);

export const httpAgentConnectionStatusHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const claimHandle = requiredString(body, "claimHandle");
    if (claimHandle instanceof Response) return claimHandle;
    const now = Date.now();
    const status = await ctx.runQuery(
      internal.tables.agentConnections.claimStatus,
      { claimHandle, now },
    );
    if (!status)
      return errorResponse(401, "Unknown claim handle", "UNAUTHORIZED");
    const nextAction =
      status.handoffStatus === "waiting_for_approval" ||
      status.handoffStatus === "waiting_for_pickup"
        ? {
            type: "poll_or_claim",
            method: "POST",
            path:
              status.handoffStatus === "waiting_for_pickup"
                ? "/api/agent-connections/claim"
                : "/api/agent-connections/status",
            requiredBodyFields: ["claimHandle"],
          }
        : status.handoffStatus === "waiting_for_ack"
          ? {
              type: "persist_then_ack",
              method: "POST",
              path: "/api/agent-connections/ack",
              requiredBodyFields: ["claimHandle", "agentConnectionSecret"],
            }
          : status.handoffStatus === "waiting_for_activation"
            ? {
                type: "persist_then_activate",
                method: "POST",
                path: "/api/agent-connections/activate",
                requiredHeaders: [
                  "x-agent-connection-id",
                  "x-agent-connection-secret",
                ],
              }
            : status.handoffStatus === "ready"
              ? { type: "use_connection" }
              : { type: "stop_and_request_new_pairing" };
    return jsonResponse(200, { ...status, serverTime: now, nextAction });
  },
);

export const httpAgentConnectionClaimHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const claimHandle = requiredString(body, "claimHandle");
    if (claimHandle instanceof Response) return claimHandle;
    try {
      const result = await ctx.runMutation(
        internal.tables.agentConnections.claim,
        { claimHandle },
      );
      if (result.kind === "error")
        return errorResponse(result.status, result.reason, result.code);
      if (result.kind === "pending") {
        return jsonResponse(202, {
          status: "pending",
          approvalDeadlineAt: result.approvalDeadlineAt,
          serverTime: Date.now(),
          nextAction: {
            type: "poll_status",
            method: "POST",
            path: "/api/agent-connections/status",
            requiredBodyFields: ["claimHandle"],
          },
        });
      }
      return jsonResponse(200, {
        ...result,
        handoffStatus: result.activationRequired
          ? "awaiting_activation"
          : "awaiting_ack",
        serverTime: Date.now(),
        nextAction: result.activationRequired
          ? {
              type: "persist_then_activate",
              method: "POST",
              path: "/api/agent-connections/activate",
              requiredHeaders: [
                "x-agent-connection-id",
                "x-agent-connection-secret",
              ],
            }
          : {
              type: "persist_then_ack",
              method: "POST",
              path: "/api/agent-connections/ack",
              requiredBodyFields: ["claimHandle", "agentConnectionSecret"],
            },
      });
    } catch (error) {
      return errorResponse(
        503,
        error instanceof Error ? error.message : "Connection claim failed",
        "PROVIDER_ERROR",
      );
    }
  },
);

export const httpAgentConnectionAckHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const claimHandle = requiredString(body, "claimHandle");
    if (claimHandle instanceof Response) return claimHandle;
    const agentConnectionSecret = requiredString(body, "agentConnectionSecret");
    if (agentConnectionSecret instanceof Response) return agentConnectionSecret;
    const ok = await ctx.runMutation(
      internal.tables.agentConnections.acknowledgeClaim,
      { claimHandle, agentConnectionSecret },
    );
    return ok.ok
      ? jsonResponse(200, {
          ...ok,
          handoffStatus: ok.resourceStatus === "active" ? "ready" : "revoked",
          serverTime: Date.now(),
        })
      : errorResponse(ok.status, ok.reason, ok.code, ok);
  },
);
