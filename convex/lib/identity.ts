import { ConvexError } from "convex/values";
import type { Auth } from "convex/server";
import { env } from "../_generated/server";

export async function ownerId(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  // Every app in a WorkOS environment shares one issuer; only the web app may act as owner.
  if (
    !identity ||
    identity.issuer !==
      `https://api.workos.com/user_management/${env.WORKOS_CLIENT_ID}` ||
    identity.client_id !== env.WORKOS_CLIENT_ID
  )
    throw new ConvexError("authority-invalid");
  return identity.subject;
}

// An MCP app acting for its owner. clientKey is the OAuth client_id: a URL for
// apps that use a Client ID Metadata Document, or an id from registration.
export async function mcpCaller(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  const clientKey = identity?.client_id ?? identity?.azp;
  if (
    !identity ||
    !env.WORKOS_AUTHKIT_DOMAIN ||
    identity.issuer !== env.WORKOS_AUTHKIT_DOMAIN ||
    typeof clientKey !== "string" ||
    !clientKey ||
    clientKey.length > 500
  )
    throw new ConvexError("authority-invalid");
  return { ownerId: identity.subject, clientKey };
}
