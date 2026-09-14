import { env } from "../_generated/server";
import type { ProviderId } from "../domain/apps";

const ALLOWED_RETURN_PATHS = new Set(["/", "/connections"]);

export function parseBoardOrigin(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("BOARD_ORIGIN must use http or https");
    }
    return url.origin;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BOARD_ORIGIN")) {
      throw error;
    }
    throw new Error("BOARD_ORIGIN must be a valid http(s) origin");
  }
}

export function resolveReturnTo(
  value: string | null,
  boardOrigin: string,
): string {
  const fallback = `${boardOrigin}/connections`;
  if (!value) {
    return fallback;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallback;
    }
    if (url.origin !== boardOrigin) {
      return fallback;
    }
    const path = ALLOWED_RETURN_PATHS.has(url.pathname)
      ? url.pathname
      : "/connections";
    return `${url.origin}${path}`;
  } catch {
    return fallback;
  }
}

export function allowedReturnTo(value: string | null): string {
  return resolveReturnTo(value, parseBoardOrigin(env.BOARD_ORIGIN));
}

export function redirectTo(
  returnTo: string,
  provider: ProviderId,
  status: string,
  reason?: string,
): Response {
  const url = new URL(returnTo);
  url.searchParams.set(provider, status);
  if (reason) {
    url.searchParams.set("reason", reason);
  }
  return Response.redirect(url.toString(), 302);
}
