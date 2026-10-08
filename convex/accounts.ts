import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { endForAccount } from "./approvals";
import { ownerId } from "./lib/identity";
import { connectorFor } from "../shared/connectors";

async function owned(ctx: QueryCtx, id: Id<"accounts">) {
  const owner = await ownerId(ctx),
    row = await ctx.db.get("accounts", id);
  if (!row || row.ownerId !== owner) throw new ConvexError("authority-invalid");
  return row;
}

export const list = query({
  args: {},
  returns: v.array(schema.doc("accounts")),
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    return await ctx.db
      .query("accounts")
      .withIndex("by_ownerId_and_providerId", (q) => q.eq("ownerId", owner))
      .take(50);
  },
});

export const get = query({
  args: { id: v.id("accounts") },
  returns: schema.doc("accounts"),
  handler: async (ctx, args) => owned(ctx, args.id),
});

// One account per provider: connecting again replaces it.
export const save = mutation({
  args: {
    providerId: v.string(),
    connectorId: v.string(),
    installationId: v.optional(v.string()),
    label: v.string(),
    grantedScopes: v.optional(v.array(v.string())),
  },
  returns: v.object({
    replaced: v.optional(
      v.object({
        connectorId: v.string(),
        installationId: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const owner = await ownerId(ctx),
      label = args.label.trim();
    if (
      !connectorFor(args.providerId) ||
      !args.connectorId ||
      !label ||
      label.length > 200 ||
      (args.grantedScopes &&
        (args.grantedScopes.length > 100 ||
          args.grantedScopes.some((s) => !s || s.length > 100)))
    )
      throw new ConvexError("invalid-input");
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_ownerId_and_providerId", (q) =>
        q.eq("ownerId", owner).eq("providerId", args.providerId),
      )
      .first();
    const fields = {
      connectorId: args.connectorId,
      installationId: args.installationId,
      label,
      permissions: args.grantedScopes && {
        scopes: args.grantedScopes,
        checkedAt: Date.now(),
      },
    };
    if (!existing) {
      await ctx.db.insert("accounts", {
        ownerId: owner,
        providerId: args.providerId,
        ...fields,
      });
      return {};
    }
    await ctx.db.patch("accounts", existing._id, fields);
    const same =
      existing.connectorId === args.connectorId &&
      existing.installationId === args.installationId;
    if (same) return {};
    await endForAccount(ctx, existing._id);
    return {
      replaced: {
        connectorId: existing.connectorId,
        installationId: existing.installationId,
      },
    };
  },
});

export const remove = mutation({
  args: { id: v.id("accounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.id);
    await endForAccount(ctx, row._id);
    await ctx.db.delete("accounts", row._id);
    return null;
  },
});
