import { httpRouter } from "convex/server";
import {
  describeCredentials,
  handleCredentials,
  handleHealth,
  handlePlatforms,
  optionsOk,
} from "./httpAgent";
import { oauthCallback, oauthConnect } from "./httpOauth";
import { PROVIDERS } from "./permissions";

const http = httpRouter();

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
http.route({
  path: "/api/platforms",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/platforms",
  method: "GET",
  handler: handlePlatforms,
});
http.route({
  path: "/api/health",
  method: "GET",
  handler: handleHealth,
});

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
