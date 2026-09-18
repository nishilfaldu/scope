import { AGENT_ERROR_GUIDANCE, type AgentErrorCode } from "./errors";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, x-slice-token, x-slice-secret",
  "Content-Type": "application/json",
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
}

export function corsNoContent(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function errorResponse(
  status: number,
  error: string,
  code: AgentErrorCode,
): Response {
  return jsonResponse(status, { error, code, ...AGENT_ERROR_GUIDANCE[code] });
}
