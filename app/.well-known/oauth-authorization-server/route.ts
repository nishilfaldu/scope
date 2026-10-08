import { corsHeaders } from "@/lib/gateway";
import { config } from "@/lib/scope-server";

// For MCP clients that skip protected-resource metadata. AuthKit stays the source of truth.
export async function GET() {
  const upstream = await fetch(
    `${config("WORKOS_AUTHKIT_DOMAIN")}/.well-known/oauth-authorization-server`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (!upstream.ok)
    return new Response(null, { status: 502, headers: corsHeaders });
  return Response.json(await upstream.json(), {
    headers: { ...corsHeaders, "Cache-Control": "public, max-age=300" },
  });
}
