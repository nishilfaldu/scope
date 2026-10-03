import { ConvexHttpClient } from "convex/browser";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
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
    token = await convexAuthNextjsToken();
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
export function safeError(status = 400) {
  return json(
    { error: "Request unavailable. Check your sign-in and setup." },
    status,
  );
}
export async function clientActor(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new Error("Unauthorized client");
  return {
    secret: config("SCOPE_SERVICE_SECRET"),
    ...(await verifyClient(token, {
      issuer: config("WORKOS_ISSUER"),
      resource: scopeOrigin() + "/api/mcp",
    })),
  };
}
