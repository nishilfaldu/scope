import { httpRouter } from "convex/server";
import { httpAction, env } from "./_generated/server";
import { jsonResponse } from "./lib/responses";
const http = httpRouter();
http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async () =>
    jsonResponse(200, {
      name: "Scope",
      cliUrl: new URL("/api/cli", env.SCOPE_ORIGIN).toString(),
    }),
  ),
});
export default http;
