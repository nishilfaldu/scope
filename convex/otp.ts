import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const WINDOW_MS = 60 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_SENDS = 5;
const MAX_GLOBAL_SENDS = 100;

export const allowSend = internalMutation({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { email }) => {
    const now = Date.now();
    const normalized = email.trim().toLowerCase();
    const current = await ctx.db
      .query("otpSendLimits")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    const global = await ctx.db
      .query("otpSendLimits")
      .withIndex("by_email", (q) => q.eq("email", "_global"))
      .unique();
    const globalInWindow = global && now - global.windowStart < WINDOW_MS;
    if (globalInWindow && global.sent >= MAX_GLOBAL_SENDS) return false;
    const inWindow = current && now - current.windowStart < WINDOW_MS;
    if (
      current &&
      (now - current.lastSentAt < MIN_INTERVAL_MS ||
        (inWindow && current.sent >= MAX_SENDS))
    )
      return false;
    if (current) {
      await ctx.db.patch("otpSendLimits", current._id, {
        windowStart: inWindow ? current.windowStart : now,
        sent: inWindow ? current.sent + 1 : 1,
        lastSentAt: now,
      });
    } else {
      await ctx.db.insert("otpSendLimits", {
        email: normalized,
        windowStart: now,
        lastSentAt: now,
        sent: 1,
      });
    }
    if (global) {
      await ctx.db.patch("otpSendLimits", global._id, {
        windowStart: globalInWindow ? global.windowStart : now,
        sent: globalInWindow ? global.sent + 1 : 1,
        lastSentAt: now,
      });
    } else {
      await ctx.db.insert("otpSendLimits", {
        email: "_global",
        windowStart: now,
        lastSentAt: now,
        sent: 1,
      });
    }
    return true;
  },
});
