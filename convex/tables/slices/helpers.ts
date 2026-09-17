import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AppId } from "../../domain/apps";
import type { AgentErrorCode } from "../../lib/errors";
import { hashesEqual, randomSecret, sha256Hex } from "../../lib/secrets";
import { connectionsForApp, selectedConnection } from "../connections/helpers";

export const MAX_SLICE_NAME = 80;
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SLICE_APPS = 1500;
export type MintPolicy = "auto" | "approve";
export type Binding = { app: AppId; connectionId: Id<"connections"> };

export function effectiveStatus(slice: Pick<Doc<"slices">, "status" | "expiresAt">, now = Date.now()) {
  return slice.status === "revoked" ? "revoked" as const : slice.expiresAt <= now ? "expired" as const : "active" as const;
}

export function withoutSecretHash(slice: Doc<"slices">) {
  return {
    _id: slice._id, _creationTime: slice._creationTime,
    userId: slice.userId, name: slice.name, token: slice.token,
    status: effectiveStatus(slice), expiresAt: slice.expiresAt,
    mintPolicy: slice.mintPolicy,
  };
}

export async function sliceBySecret(ctx: QueryCtx | MutationCtx, args: { sliceToken: string; sliceSecret: string }) {
  const slice = await ctx.db.query("slices")
    .withIndex("by_token", (q) => q.eq("token", args.sliceToken)).unique();
  if (!slice || !hashesEqual(await sha256Hex(args.sliceSecret), slice.secretHash)) return null;
  return slice;
}

export async function bindingFor(ctx: Pick<QueryCtx | MutationCtx, "db">, sliceId: Id<"slices">, app: AppId) {
  return await ctx.db.query("sliceBindings")
    .withIndex("by_slice_app", (q) => q.eq("sliceId", sliceId).eq("app", app)).unique();
}

export async function validatedBindings(
  ctx: Pick<MutationCtx, "db">, userId: Id<"users">, apps: AppId[], chosen?: Binding[],
): Promise<Binding[]> {
  if (apps.length === 0 || apps.length > MAX_SLICE_APPS || new Set(apps).size !== apps.length) {
    throw new Error(`Select between 1 and ${MAX_SLICE_APPS} distinct apps`);
  }
  const bindings = chosen ?? (await Promise.all(apps.map(async (app) => {
    const accounts = await connectionsForApp(ctx, userId, app);
    return accounts.length === 1 ? { app, connectionId: accounts[0]._id } : null;
  }))).filter((binding): binding is Binding => binding !== null);
  if (bindings.length !== apps.length || new Set(bindings.map((binding) => binding.app)).size !== apps.length) {
    throw new Error("Select one account for each app");
  }
  const selected = new Map(bindings.map((binding) => [binding.app, binding.connectionId]));
  await Promise.all(apps.map(async (app) => {
    const connectionId = selected.get(app);
    if (!connectionId || !await selectedConnection(ctx, userId, app, connectionId)) {
      throw new Error(`Select a connected account for ${app}`);
    }
  }));
  return bindings;
}

export async function createSlice(
  ctx: MutationCtx,
  args: { userId: Id<"users">; name: string; ttlMs: number; mintPolicy: MintPolicy; bindings: Binding[] },
) {
  const token = randomSecret("st_");
  const sliceSecret = randomSecret("ss_");
  const expiresAt = Date.now() + args.ttlMs;
  const id = await ctx.db.insert("slices", {
    userId: args.userId, name: args.name, token,
    secretHash: await sha256Hex(sliceSecret), status: "active",
    expiresAt, mintPolicy: args.mintPolicy,
  });
  await Promise.all(args.bindings.map((binding) =>
    ctx.db.insert("sliceBindings", { sliceId: id, ...binding })));
  return { id, sliceToken: token, sliceSecret, expiresAt, name: args.name,
    apps: args.bindings.map((binding) => binding.app), mintPolicy: args.mintPolicy };
}

export function denyCreate(status: number, reason: string, code: AgentErrorCode) {
  return { ok: false as const, status, reason, code };
}
