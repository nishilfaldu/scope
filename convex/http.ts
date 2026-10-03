import { httpRouter } from "convex/server";
import { consumeTicket, connectConfigured } from "./connect/bridge";
import { httpAction, env } from "./_generated/server";
import { httpOAuthCallback, httpOAuthConnect } from "./http/oauth";
import { jsonResponse } from "./lib/responses";
import { ALL_APPS } from "./domain/apps";
import { auth } from "./auth";
const http = httpRouter();
auth.addHttpRoutes(http);
http.route({
  path: "/api/connect/ticket",
  method: "POST",
  handler: consumeTicket,
});
http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async () =>
    jsonResponse(200, {
      name: "Scope",
      agentAccess: "WorkOS-authorized MCP",
      mcpUrl: new URL("/api/probe/mcp", env.BOARD_ORIGIN).toString(),
      credentials:
        "Provider credentials are used only by the private local helper. Sign in through MCP; approve each account request in Scope.",
    }),
  ),
});
http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () =>
    jsonResponse(200, { ok: true, oauth: { slack: connectConfigured() } }),
  ),
});
for (const app of ALL_APPS) {
  http.route({
    path: `/api/${app}/connect`,
    method: "GET",
    handler: httpOAuthConnect(app),
  });
  http.route({
    path: `/api/${app}/callback`,
    method: "GET",
    handler: httpOAuthCallback(app),
  });
}
export default http;
