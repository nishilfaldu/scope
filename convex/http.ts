import { httpRouter } from "convex/server";
import {
  describeCredentials,
  handleCredentials,
  handleHealth,
  handleApps,
  optionsOk,
} from "./httpAgent";
import { oauthCallback, oauthConnect } from "./http/oauth";
import { PROVIDERS } from "./permissions";

const http = httpRouter();

// /api/credentials
http.route({
  path: "/api/credentials",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/credentials",
  method: "GET",
  handler: describeCredentials,
});
http.route({
  path: "/api/credentials",
  method: "POST",
  handler: handleCredentials,
});

// /api/apps
http.route({
  path: "/api/apps",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/apps",
  method: "GET",
  handler: handleApps,
});
http.route({
  path: "/api/health",
  method: "GET",
  handler: handleHealth,
});

// /api/provider/connect
// /api/provider/callback
for (const provider of PROVIDERS) {
  http.route({
    path: `/api/${provider}/connect`,
    method: "GET",
    handler: oauthConnect(provider),
  });
  http.route({
    path: `/api/${provider}/callback`,
    method: "GET",
    handler: oauthCallback(provider),
  });
}

export default http;
