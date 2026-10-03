import { httpRouter } from "convex/server";
import { httpAction, env } from "./_generated/server";
import { jsonResponse } from "./lib/responses";
import { auth } from "./auth";
const http = httpRouter();
auth.addHttpRoutes(http);
http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async () =>
    jsonResponse(200, {
      name: "Scope",
      mcpUrl: new URL("/api/mcp", env.SCOPE_ORIGIN).toString(),
    }),
  ),
});
export default http;
