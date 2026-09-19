import { httpAction, env } from "../_generated/server";
import { internal } from "../_generated/api";
import { readObjectBody, requiredString } from "../lib/requests";
import { errorResponse, jsonResponse } from "../lib/responses";
import { parseBoardOrigin } from "./helpers";

export const httpCreateAgentConnectionHandler = httpAction(
  async (ctx, request) => {
    const body = await readObjectBody(request);
    if (body instanceof Response) return body;
    const agentName = requiredString(body, "agentName");
    if (agentName instanceof Response) return agentName;
    try {
      const created = await ctx.runMutation(
        internal.tables.agentConnections.createInvite,
        { agentName },
      );
      return jsonResponse(201, {
        agentName: created.agentName,
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
