import { ConvexError, v } from "convex/values";
import { defaultRule, toolFor, tools, type ToolInfo } from "../shared/tools";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { onlyAccount, openPending, spendApproval } from "./approvals";
import { mcpCaller } from "./lib/identity";

// MCP-facing. The AuthKit access token is the only authority.

const deniedCooldownMs = 2 * 60_000,
  maxWaiting = 5;

function fallbackName(clientKey: string) {
  try {
    return new URL(clientKey).hostname;
  } catch {
    return "MCP app";
  }
}

async function findClient(
  ctx: QueryCtx,
  caller: { ownerId: string; clientKey: string },
) {
  const client = await ctx.db
    .query("clients")
    .withIndex("by_ownerId_and_clientKey", (q) =>
      q.eq("ownerId", caller.ownerId).eq("clientKey", caller.clientKey),
    )
    .unique();
  if (client?.revokedAt !== undefined) throw new ConvexError("client-revoked");
  return client;
}

async function ensureClient(ctx: MutationCtx, name?: string) {
  const caller = await mcpCaller(ctx),
    now = Date.now();
  const client = await findClient(ctx, caller);
  if (!client) {
    const id = await ctx.db.insert("clients", {
      ownerId: caller.ownerId,
      clientKey: caller.clientKey,
      name: name || fallbackName(caller.clientKey),
      lastUsedAt: now,
    });
    return (await ctx.db.get("clients", id))!;
  }
  // Skip the write for back-to-back calls so parallel calls do not conflict.
  if (name && name !== client.name)
    await ctx.db.patch("clients", client._id, { name, lastUsedAt: now });
  else if (!client.lastUsedAt || now - client.lastUsedAt > 60_000)
    await ctx.db.patch("clients", client._id, { lastUsedAt: now });
  return client;
}

export async function ruleFor(
  ctx: QueryCtx,
  clientId: Id<"clients"> | undefined,
  tool: ToolInfo,
) {
  if (!clientId) return defaultRule(tool);
  const row = await ctx.db
    .query("rules")
    .withIndex("by_clientId_and_tool", (q) =>
      q.eq("clientId", clientId).eq("tool", tool.name),
    )
    .unique();
  return row?.rule ?? defaultRule(tool);
}

async function log(
  ctx: MutationCtx,
  client: Doc<"clients">,
  tool: string,
  decision: Doc<"calls">["decision"],
) {
  return ctx.db.insert("calls", {
    ownerId: client.ownerId,
    clientId: client._id,
    tool,
    decision,
  });
}

// clientInfo.name values that are ids rather than product names.
const knownApps: Record<string, string> = {
  "cursor-vscode": "Cursor",
  "claude-code": "Claude Code",
  "claude-ai": "Claude",
  "openai-mcp": "ChatGPT",
};

// Records the app's display name from the MCP initialize request.
export const hello = mutation({
  args: { name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    await ensureClient(
      ctx,
      knownApps[name] ?? (name.slice(0, 100) || undefined),
    );
    return null;
  },
});

// Tool names this app may see. Blocked tools are hidden.
export const visibleTools = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const client = await findClient(ctx, await mcpCaller(ctx));
    const visible: string[] = [];
    for (const tool of tools)
      if ((await ruleFor(ctx, client?._id, tool)) !== "block")
        visible.push(tool.name);
    return visible;
  },
});

const account = v.object({
  ownerId: v.string(),
  providerId: v.string(),
  connectorId: v.string(),
  installationId: v.optional(v.string()),
});

// Without a summary, a call that needs a new request returns "describe" so the
// gateway can build one from provider data rather than from the model's input.
export const authorize = mutation({
  args: {
    tool: v.string(),
    summary: v.optional(v.string()),
    argsHash: v.string(),
  },
  returns: v.union(
    v.object({
      decision: v.literal("run"),
      callId: v.id("calls"),
      account,
    }),
    v.object({ decision: v.literal("describe"), account }),
    v.object({
      decision: v.literal("waiting"),
      approvalId: v.id("approvals"),
    }),
    v.object({
      decision: v.union(
        v.literal("blocked"),
        v.literal("denied"),
        v.literal("busy"),
        v.literal("no-account"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const tool = toolFor(args.tool),
      summary = args.summary?.trim().slice(0, 300);
    if (!tool || summary === "" || args.argsHash.length > 100)
      throw new ConvexError("invalid-input");
    const client = await ensureClient(ctx);
    const account = await onlyAccount(ctx, client.ownerId, tool.providerId);
    if (!account) {
      await log(ctx, client, tool.name, "no-account");
      return { decision: "no-account" as const };
    }
    const grant = {
      ownerId: account.ownerId,
      providerId: account.providerId,
      connectorId: account.connectorId,
      installationId: account.installationId,
    };
    const run = async (decision: "allowed" | "approved") => ({
      decision: "run" as const,
      callId: await log(ctx, client, tool.name, decision),
      account: grant,
    });
    const rule = await ruleFor(ctx, client._id, tool);
    if (rule === "block") {
      await log(ctx, client, tool.name, "blocked");
      return { decision: "blocked" as const };
    }
    if (rule === "allow") return run("allowed");

    const now = Date.now();
    const rows = (status: "approved" | "pending" | "denied") =>
      ctx.db
        .query("approvals")
        .withIndex("by_clientId_and_status_and_tool", (q) =>
          q
            .eq("clientId", client._id)
            .eq("status", status)
            .eq("tool", tool.name),
        )
        .order("desc")
        .take(20);
    const approved = (await rows("approved")).find(
      (row) =>
        row.expiresAt > now &&
        row.accountId === account._id &&
        (!row.once || row.argsHash === args.argsHash),
    );
    if (approved) {
      await spendApproval(ctx, approved);
      return run("approved");
    }
    const pending = (await rows("pending")).filter(
      (row) => row.expiresAt > now,
    );
    const same = pending.find((row) => row.argsHash === args.argsHash);
    if (same) return { decision: "waiting" as const, approvalId: same._id };
    const denied = (await rows("denied")).find(
      (row) =>
        row.argsHash === args.argsHash &&
        (row.decidedAt ?? 0) > now - deniedCooldownMs,
    );
    if (denied) {
      await log(ctx, client, tool.name, "denied");
      return { decision: "denied" as const };
    }
    if (pending.length >= maxWaiting) return { decision: "busy" as const };
    if (!summary) return { decision: "describe" as const, account: grant };
    const approvalId = await openPending(ctx, {
      ownerId: client.ownerId,
      clientId: client._id,
      tool: tool.name,
      argsHash: args.argsHash,
      providerId: tool.providerId,
      reason: summary,
    });
    await log(ctx, client, tool.name, "waiting");
    return { decision: "waiting" as const, approvalId };
  },
});

export const approvalStatus = query({
  args: { id: v.id("approvals") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const client = await findClient(ctx, await mcpCaller(ctx)),
      row = await ctx.db.get("approvals", args.id);
    if (!client || !row || row.clientId !== client._id)
      throw new ConvexError("authority-invalid");
    return row.status;
  },
});

export const finish = mutation({
  args: {
    callId: v.id("calls"),
    outcome: v.union(v.literal("ok"), v.literal("failed")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await findClient(ctx, await mcpCaller(ctx)),
      call = await ctx.db.get("calls", args.callId);
    if (!client || !call || call.clientId !== client._id || call.outcome)
      throw new ConvexError("authority-invalid");
    await ctx.db.patch("calls", call._id, { outcome: args.outcome });
    return null;
  },
});
