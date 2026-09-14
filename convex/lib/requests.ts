import { errorResponse } from "./responses";
import { isPlainObject } from "../lib/json";

export async function readObjectBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body", "INVALID_REQUEST");
  }
  if (!isPlainObject(raw)) {
    return errorResponse(400, "Body must be a JSON object", "INVALID_REQUEST");
  }
  return raw;
}

export function requiredString(
  body: Record<string, unknown>,
  key: string,
): string | Response {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    return errorResponse(400, `${key} must be a string`, "INVALID_REQUEST");
  }
  return value;
}

export function requiredHeader(request: Request, key: string): string | Response {
  const value = request.headers.get(key);
  if (typeof value !== "string" || value.length === 0) {
    return errorResponse(400, `${key} must be a string`, "INVALID_REQUEST");
  }
  return value;
}
