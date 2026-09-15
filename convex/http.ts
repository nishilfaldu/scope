import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { httpAppsHandler } from "./http/httpAppsHandler";
import { httpCredentialsHandler } from "./http/httpCredentialsHandler";
import { discoverySpec } from "./http/contracts";
import {
  httpOAuthCallback,
  httpOAuthConnect,
} from "./http/oauth";
import { corsNoContent, jsonResponse } from "./lib/responses";
import { PROVIDERS } from "./domain/apps";
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

// Health check
http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () =>
    jsonResponse(200, { ok: true, oauth: oauthConfigured() }),
  ),
});

// OAuth provider connection
for (const provider of PROVIDERS) {
  http.route({
    path: `/api/${provider}/connect`,
    method: "GET",
    handler: httpOAuthConnect(provider),
  });
  http.route({
    path: `/api/${provider}/callback`,
    method: "GET",
    handler: httpOAuthCallback(provider),
  });
}

export default http;
