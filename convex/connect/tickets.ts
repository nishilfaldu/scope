import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { randomSecret, sha256Hex } from "../lib/secrets";
import { bridgeCommandValidator } from "./contracts";

export const issue = internalMutation({
  args: { command: bridgeCommandValidator },
  returns: v.string(),
  handler: async (ctx, args) => {
    const ticket = randomSecret("cb_", 32);
    const id = await ctx.db.insert("connectBridgeTickets", {
      secretHash: await sha256Hex(ticket),
      expiresAt: Date.now() + 60_000,
      command: args.command,
    });
    await ctx.scheduler.runAfter(60_000, internal.connect.tickets.expire, {
      id,
    });
    return ticket;
  },
});
export const expire = internalMutation({
  args: { id: v.id("connectBridgeTickets") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (await ctx.db.get("connectBridgeTickets", id))
      await ctx.db.delete("connectBridgeTickets", id);
    return null;
  },
});
export const consume = internalMutation({
  args: { ticket: v.string() },
  returns: v.union(bridgeCommandValidator, v.null()),
  handler: async (ctx, { ticket }) => {
    if (!/^cb_[a-f0-9]{64}$/.test(ticket)) return null;
    const hash = await sha256Hex(ticket);
    const row = await ctx.db
      .query("connectBridgeTickets")
      .withIndex("by_secretHash", (q) => q.eq("secretHash", hash))
      .unique();
    if (!row) return null;
    await ctx.db.delete("connectBridgeTickets", row._id);
    return row.expiresAt > Date.now() ? row.command : null;
  },
});
