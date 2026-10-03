import { config, json, scopeOrigin } from "@/lib/scope-server";
export function GET() {
  return json({
    resource: scopeOrigin() + "/api/mcp",
    authorization_servers: [config("WORKOS_ISSUER")],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    bearer_methods_supported: ["header"],
  });
}
