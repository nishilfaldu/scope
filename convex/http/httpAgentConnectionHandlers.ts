import { internal } from "../_generated/api";
import { env, httpAction } from "../_generated/server";
import { parseBoardOrigin } from "../domain/returnPaths";
import {
  readObjectBody,
  requiredHeader,
  requiredString,
} from "../lib/requests";
import { errorResponse, jsonResponse } from "../lib/responses";

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
        expiresAt: created.expiresAt,
      });
    } catch (error) {
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
      return errorResponse(
        401,
        "Replacement cannot be activated",
        "UNAUTHORIZED",
      );
    }
    return jsonResponse(200, result);
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
    const status = await ctx.runQuery(
      internal.tables.agentConnections.claimStatus,
      { claimHandle },
    );
    if (!status)
      return errorResponse(401, "Unknown claim handle", "UNAUTHORIZED");
    return jsonResponse(200, status);
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
      if (result.kind === "pending") {
        return jsonResponse(202, {
          status: "pending",
          expiresAt: result.expiresAt,
        });
      }
      return jsonResponse(200, result);
    } catch (error) {
      return errorResponse(
        403,
        error instanceof Error ? error.message : "Connection unavailable",
        "UNAUTHORIZED",
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
    return ok
      ? jsonResponse(200, { ok: true })
      : errorResponse(403, "Claim unavailable", "UNAUTHORIZED");
  },
);
