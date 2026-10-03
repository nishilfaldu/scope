import { config, json } from "@/lib/probe-server";
export function GET() {
  return json({
    resource: config("SCOPE_PROBE_ORIGIN") + "/api/probe/mcp",
    authorization_servers: [config("WORKOS_ISSUER")],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    bearer_methods_supported: ["header"],
  });
}
