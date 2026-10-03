import { httpRouter } from "convex/server";
import { consumeTicket } from "./connect/bridge";
import { httpAction } from "./_generated/server";
import { httpAppsHandler } from "./http/httpAppsHandler";
import { httpAccountsHandler } from "./http/httpAccountsHandler";
import { httpClaimHandler } from "./http/httpClaimHandler";
import { httpCredentialsHandler } from "./http/httpCredentialsHandler";
import { httpGoogleBrokerHandler } from "./http/googleBroker";
import {
  httpAccessRequestClaimHandler,
  httpAccessRequestAckHandler,
  httpCancelAccessRequestHandler,
  httpAccessRequestStatusHandler,
  httpCreateAccessRequestHandler,
} from "./http/httpAccessRequestHandlers";
import { discoverySpec } from "./http/contracts";
import { httpOAuthCallback, httpOAuthConnect } from "./http/oauth";
import { corsNoContent, jsonResponse } from "./lib/responses";
import { ALL_APPS } from "./domain/apps";
import { oauthConfigured } from "./oauth";
import { auth } from "./auth";
import {
  httpAgentConnectionClaimHandler,
  httpAgentConnectionAckHandler,
  httpActivateAgentConnectionHandler,
  httpCancelAgentConnectionInviteHandler,
  httpRevokeAgentConnectionHandler,
  httpAgentConnectionStatusHandler,
  httpCreateAgentConnectionHandler,
} from "./http/httpAgentConnectionHandlers";
import {
  httpCancelTokenRequestHandler,
  httpRevokeSliceHandler,
} from "./http/httpAgentSliceHandlers";

const http = httpRouter();
http.route({
  path: "/api/connect/ticket",
  method: "POST",
  handler: consumeTicket,
});
const optionsOk = httpAction(async () => corsNoContent());

// Auth routes
auth.addHttpRoutes(http);

// API discovery
http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async (_ctx, request) =>
    jsonResponse(200, {
      ...discoverySpec,
      rediscoveryUrl: new URL("/", request.url).toString(),
    }),
  ),
});
// Agent-initiated onboarding (approval link)
for (const [path, handler] of [
  ["/api/agent-connections", httpCreateAgentConnectionHandler],
  ["/api/agent-connections/status", httpAgentConnectionStatusHandler],
  ["/api/agent-connections/claim", httpAgentConnectionClaimHandler],
  ["/api/agent-connections/ack", httpAgentConnectionAckHandler],
  ["/api/agent-connections/activate", httpActivateAgentConnectionHandler],
  ["/api/agent-connections/cancel", httpCancelAgentConnectionInviteHandler],
  ["/api/agent-connections/revoke", httpRevokeAgentConnectionHandler],
] as const) {
  http.route({ path, method: "OPTIONS", handler: optionsOk });
  http.route({ path, method: "POST", handler });
}

http.route({
  path: "/api/access-requests",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/access-requests/cancel",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/access-requests/cancel",
  method: "POST",
  handler: httpCancelAccessRequestHandler,
});
http.route({
  path: "/api/access-requests",
  method: "POST",
  handler: httpCreateAccessRequestHandler,
});

for (const [path, handler] of [
  ["/api/slices/revoke", httpRevokeSliceHandler],
  ["/api/credentials/cancel", httpCancelTokenRequestHandler],
] as const) {
  http.route({ path, method: "OPTIONS", handler: optionsOk });
  http.route({ path, method: "POST", handler });
}
http.route({
  path: "/api/access-requests/status",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/access-requests/status",
  method: "POST",
  handler: httpAccessRequestStatusHandler,
});
http.route({
  path: "/api/access-requests/claim",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/access-requests/ack",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/access-requests/ack",
  method: "POST",
  handler: httpAccessRequestAckHandler,
});
http.route({
  path: "/api/access-requests/claim",
  method: "POST",
  handler: httpAccessRequestClaimHandler,
});

// Credential issuance
http.route({
  path: "/api/credentials",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/credentials",
  method: "POST",
  handler: httpCredentialsHandler,
});
http.route({
  path: "/api/google/operations",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/google/operations",
  method: "POST",
  handler: httpGoogleBrokerHandler,
});

// Poll / claim after operator approval (mint path)
http.route({
  path: "/api/credentials/claim",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/credentials/claim",
  method: "POST",
  handler: httpClaimHandler,
});

// Scope app discovery
http.route({
  path: "/api/apps",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/apps",
  method: "GET",
  handler: httpAppsHandler,
});
http.route({ path: "/api/accounts", method: "OPTIONS", handler: optionsOk });
http.route({
  path: "/api/accounts",
  method: "GET",
  handler: httpAccountsHandler,
});

// Health check
http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () =>
    jsonResponse(200, { ok: true, oauth: oauthConfigured() }),
  ),
});

// OAuth provider connection
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
