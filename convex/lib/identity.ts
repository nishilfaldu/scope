import { ConvexError } from "convex/values";
import type { Auth } from "convex/server";
import { env, type QueryCtx } from "../_generated/server";

export async function ownerId(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  // Every app in a WorkOS environment shares one issuer; only the web app may act as owner.
  if (!identity || identity.client_id !== env.WORKOS_CLIENT_ID)
    throw new ConvexError("authority-invalid");
  return identity.subject;
}

export function newAgentToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "scope_" + toHex(bytes);
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
}

export async function agentFor(ctx: QueryCtx, token: string) {
  if (!/^scope_[a-f0-9]{64}$/.test(token))
    throw new ConvexError("authority-invalid");
  const tokenHash = await hashToken(token);
  const agent = await ctx.db
    .query("agents")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!agent) throw new ConvexError("authority-invalid");
  return agent;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
