import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { ZodError } from "zod";
import { ProviderFailure } from "./connect";
import { failureMessage } from "@/shared/failures.mjs";

export function config(name: string): string {
  const value = process.env[name];
  if (!value) throw new ProviderFailure("configuration-invalid");
  return value;
}

export function scopeOrigin() {
  return new URL(config("SCOPE_ORIGIN")).origin;
}

export function db() {
  return new ConvexHttpClient(config("NEXT_PUBLIC_CONVEX_URL"));
}

export async function ownerSession() {
  const { user, accessToken } = await withAuth();
  if (!user || !accessToken) throw new ConvexError("authority-invalid");
  const client = db();
  client.setAuth(accessToken);
  return { client, ownerId: user.id };
}

export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== scopeOrigin())
    throw new ConvexError("authority-invalid");
}

export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function failureCode(error: unknown) {
  if (error instanceof ProviderFailure) return error.code;
  if (error instanceof ZodError || error instanceof SyntaxError)
    return "invalid-input";
  if (error instanceof ConvexError && typeof error.data === "string")
    return error.data;
  return "authority-invalid";
}

const statusFor: Record<string, number> = {
  "invalid-input": 400,
  "authority-invalid": 403,
  "no-account": 409,
  "reconnect-required": 409,
  "provider-unavailable": 503,
  "configuration-invalid": 503,
};

export function failure(error: unknown) {
  const code = failureCode(error);
  return json({ code, error: failureMessage(code) }, statusFor[code] ?? 400);
}
