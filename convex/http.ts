import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { httpAppsHandler } from "./http/httpAppsHandler";
import { httpAccountsHandler } from "./http/httpAccountsHandler";
import { httpClaimHandler } from "./http/httpClaimHandler";
import { httpCredentialsHandler } from "./http/httpCredentialsHandler";
import {
  httpAccessRequestClaimHandler,
  httpAccessRequestStatusHandler,
  httpCreateAccessRequestHandler,
} from "./http/httpAccessRequestHandlers";
import { discoverySpec } from "./http/contracts";
import { httpOAuthCallback, httpOAuthConnect } from "./http/oauth";
import { corsNoContent, jsonResponse } from "./lib/responses";
import { ALL_APPS } from "./domain/apps";
import { oauthConfigured } from "./oauth";
import { auth } from "./auth";

const http = httpRouter();
const optionsOk = httpAction(async () => corsNoContent());

// Auth routes
auth.addHttpRoutes(http);

// API discovery
http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async () => jsonResponse(200, discoverySpec)),
});
// Agent-initiated onboarding (approval link)
http.route({
  path: "/api/access-requests",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/access-requests",
  method: "POST",
  handler: httpCreateAccessRequestHandler,
});
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

// Passport app discovery
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
