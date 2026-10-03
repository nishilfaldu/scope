import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import { env, httpAction, type ActionCtx } from "../_generated/server";
import { hashesEqual } from "../lib/secrets";
import { isPlainObject } from "../lib/json";
import { bridgeCommandValidator } from "./contracts";

export function connectConfigured() {
  return Boolean(
    env.CONNECT_BRIDGE_URL?.trim() && env.CONNECT_BRIDGE_SECRET?.trim(),
  );
}
export async function callBridge(
  ctx: Pick<ActionCtx, "runMutation">,
  command: Infer<typeof bridgeCommandValidator>,
): Promise<Record<string, unknown>> {
  if (!connectConfigured()) throw new Error("Connect bridge is not configured");
  const url = new URL(env.CONNECT_BRIDGE_URL!);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && url.hostname === "localhost")
  )
    throw new Error("Invalid bridge URL");
  const ticket = await ctx.runMutation(internal.connect.tickets.issue, {
    command,
  });
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(25_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CONNECT_BRIDGE_SECRET}`,
    },
    body: JSON.stringify({ ticket }),
  });
  const raw: unknown = await response.json();
  if (!response.ok || !isPlainObject(raw))
    throw new Error("Connect bridge rejected request");
  return raw;
}

// Only the authenticated Vercel bridge can resolve a one-use command. No CORS.
export const consumeTicket = httpAction(async (ctx, request) => {
  const secret = env.CONNECT_BRIDGE_SECRET;
  if (
    !secret ||
    !hashesEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)
  )
    return new Response(null, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (
    !isPlainObject(body) ||
    typeof body.ticket !== "string" ||
    Object.keys(body).length !== 1
  )
    return new Response(null, { status: 400 });
  const command = await ctx.runMutation(internal.connect.tickets.consume, {
    ticket: body.ticket,
  });
  return command
    ? Response.json(command, { headers: { "Cache-Control": "no-store" } })
    : new Response(null, { status: 403 });
});
