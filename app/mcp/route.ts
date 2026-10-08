import { corsHeaders, handleMcp } from "@/lib/gateway";

export const maxDuration = 60;

export async function POST(request: Request) {
  return handleMcp(request);
}

// Stateless server: no standalone event stream and no sessions to delete.
function methodNotAllowed() {
  return new Response(null, {
    status: 405,
    headers: { ...corsHeaders, Allow: "POST, OPTIONS" },
  });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
