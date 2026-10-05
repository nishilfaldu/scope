import { ConvexHttpClient } from "convex/browser";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { ProviderFailure } from "./connect";
import { failureMessage } from "@/shared/failures.mjs";
import { ZodError } from "zod";
import { verifyClient } from "./client-auth";

export function config(name: string): string {
  if (process.env.VERCEL_ENV === "production")
    throw new Error("Development service is not enabled in production");
  const value = process.env[name];
  if (!value) throw new Error("Service configuration unavailable");
  return value;
}
export function scopeOrigin() {
  const origin = new URL(config("SCOPE_ORIGIN"));
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && origin.hostname === "localhost"))
  )
    throw new Error("Invalid Scope origin");
  return origin.origin;
}
export function db() {
  return new ConvexHttpClient(config("NEXT_PUBLIC_CONVEX_URL"));
}
export async function ownerDb() {
  const client = db(),
    { accessToken: token } = await withAuth();
  if (!token) throw new Error("Sign in required");
  client.setAuth(token);
  return client;
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== scopeOrigin())
    throw new Error("Origin rejected");
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function safeError(status = 400, code = "authority-invalid") {
  return json({ code, error: failureMessage(code) }, status);
}
export function safeFailure(error: unknown) {
  if (error instanceof ProviderFailure)
    return safeError(error.kind === "grant-rejected" ? 409 : 503, error.kind);
  if (error instanceof ZodError || error instanceof SyntaxError)
    return safeError(400, "invalid-input");
  const text = error instanceof Error ? error.message : "";
  if (text.includes("Connection recovery required"))
    return safeError(409, "connection-recovery");
  if (text.includes("configuration unavailable"))
    return safeError(503, "configuration-invalid");
  return safeError(409, "authority-invalid");
}
export async function clientActor(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new Error("Unauthorized client");
  return {
    secret: config("SCOPE_SERVICE_SECRET"),
    ...(await verifyClient(token, {
      webClientId: config("WORKOS_CLIENT_ID"),
      clientId: config("SCOPE_CLI_CLIENT_ID"),
    })),
  };
}
