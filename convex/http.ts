import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { handleCredentials, handleInvoke, optionsOk } from "./httpAgent";
import { oauthCallback, oauthConnect } from "./httpOauth";
import { PROVIDERS } from "./permissions";

const http = httpRouter();

http.route({
  path: "/api/invoke",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/invoke",
  method: "POST",
  handler: handleInvoke,
});
http.route({
  path: "/api/credentials",
  method: "OPTIONS",
  handler: optionsOk,
});
http.route({
  path: "/api/credentials",
  method: "POST",
  handler: handleCredentials,
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

http.route({
  path: "/api/github/webhook",
  method: "POST",
  handler: httpAction(async () => {
    return new Response(null, { status: 204 });
  }),
});

export default http;
