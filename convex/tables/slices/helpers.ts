import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AppId } from "../../domain/apps";
import type { AgentErrorCode } from "../../lib/errors";
import { hashesEqual, randomSecret, sha256Hex } from "../../lib/secrets";
import { connectionsForApp, selectedConnection } from "../connections/helpers";

export const MAX_SLICE_NAME = 80;
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type MintPolicy = "auto" | "approve";
export type Binding = { app: AppId; connectionId: Id<"connections"> };

export function effectiveStatus(
  slice: Pick<Doc<"slices">, "status" | "expiresAt">,
  now = Date.now(),
) {
  return slice.status === "revoked"
    ? ("revoked" as const)
    : slice.expiresAt <= now
      ? ("expired" as const)
      : ("active" as const);
}

export function withoutSecretHash(slice: Doc<"slices">) {
  return {
    _id: slice._id,
    _creationTime: slice._creationTime,
    userId: slice.userId,
    name: slice.name,
    token: slice.token,
    status: effectiveStatus(slice),
    expiresAt: slice.expiresAt,
    mintPolicy: slice.mintPolicy,
  };
}

export async function sliceBySecret(
  ctx: QueryCtx | MutationCtx,
  args: { sliceToken: string; sliceSecret: string },
) {
  const slice = await ctx.db
    .query("slices")
    .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
    .unique();
  if (
    !slice ||
    !hashesEqual(await sha256Hex(args.sliceSecret), slice.secretHash)
  )
    return null;
  if (!(await hasActiveAgentConnection(ctx, slice))) return null;
  return slice;
}

export async function hasActiveAgentConnection(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  slice: Pick<Doc<"slices">, "userId" | "agentConnectionId">,
) {
  if (!slice.agentConnectionId) return true;
  const connection = await ctx.db.get(
    "agentConnections",
    slice.agentConnectionId,
  );
  return connection?.status === "active" && connection.userId === slice.userId;
}

export async function bindingsForApp(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  sliceId: Id<"slices">,
  app: AppId,
) {
  return await ctx.db
    .query("sliceBindings")
    .withIndex("by_slice_app_connectionId", (q) =>
      q.eq("sliceId", sliceId).eq("app", app),
    )
    .collect();
}

export async function bindingForConnection(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  sliceId: Id<"slices">,
  app: AppId,
  connectionId: Id<"connections">,
) {
  return await ctx.db
    .query("sliceBindings")
    .withIndex("by_slice_app_connectionId", (q) =>
      q.eq("sliceId", sliceId).eq("app", app).eq("connectionId", connectionId),
    )
    .unique();
}

export async function validatedBindings(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  chosen: Binding[] | undefined,
  requestedApps?: AppId[],
): Promise<Binding[]> {
  const bindings =
    chosen ??
    (
      await Promise.all(
        (requestedApps ?? []).map(async (app) => {
          const accounts = await connectionsForApp(ctx, userId, app);
          return accounts.length === 1
            ? { app, connectionId: accounts[0]._id }
            : null;
        }),
      )
    ).filter((binding): binding is Binding => binding !== null);
  if (bindings.length === 0) throw new Error("Select at least one account");
  const keys = bindings.map(
    (binding) => `${binding.app}:${binding.connectionId}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new Error("Select each account only once");
  if (
    requestedApps &&
    (new Set(requestedApps).size !== requestedApps.length ||
      new Set(bindings.map((binding) => binding.app)).size !==
        requestedApps.length ||
      bindings.some((binding) => !requestedApps.includes(binding.app)))
  ) {
    throw new Error("Select at least one account for every requested app");
  }
  await Promise.all(
    bindings.map(async (binding) => {
      if (
        !(await selectedConnection(
          ctx,
          userId,
          binding.app,
          binding.connectionId,
        ))
      ) {
        throw new Error(`Select a connected account for ${binding.app}`);
      }
    }),
  );
  return bindings;
}

export async function createSlice(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    name: string;
    ttlMs: number;
    mintPolicy: MintPolicy;
    bindings: Binding[];
    agentConnectionId?: Id<"agentConnections">;
  },
) {
  const token = randomSecret("st_");
  const sliceSecret = randomSecret("ss_");
  const expiresAt = Date.now() + args.ttlMs;
  const id = await ctx.db.insert("slices", {
    userId: args.userId,
    agentConnectionId: args.agentConnectionId,
    name: args.name,
    token,
    secretHash: await sha256Hex(sliceSecret),
    status: "active",
    expiresAt,
    mintPolicy: args.mintPolicy,
  });
  await Promise.all(
    args.bindings.map((binding) =>
      ctx.db.insert("sliceBindings", { sliceId: id, ...binding }),
    ),
  );
  return {
    id,
    sliceToken: token,
    sliceSecret,
    expiresAt,
    name: args.name,
    apps: [...new Set(args.bindings.map((binding) => binding.app))],
    mintPolicy: args.mintPolicy,
  };
}

export function denyCreate(
  status: number,
  reason: string,
  code: AgentErrorCode,
) {
  return { ok: false as const, status, reason, code };
}
