import { corsHeaders, mcpResource } from "@/lib/gateway";
import { config } from "@/lib/scope-server";

export function GET() {
  return Response.json(
    {
      resource: mcpResource(),
      resource_name: "Scope",
      authorization_servers: [config("WORKOS_AUTHKIT_DOMAIN")],
      bearer_methods_supported: ["header"],
    },
    { headers: { ...corsHeaders, "Cache-Control": "public, max-age=300" } },
  );
}
