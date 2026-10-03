import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { appValidator } from "./domain/apps";
import { probeTables } from "./probeSchema";
import {
  bridgeCommandValidator,
  connectReferenceValidator,
} from "./connect/contracts";

export default defineSchema({
  ...authTables,
  ...probeTables,
  connectBridgeTickets: defineTable({
    secretHash: v.string(),
    expiresAt: v.number(),
    command: bridgeCommandValidator,
  }).index("by_secretHash", ["secretHash"]),
  connections: defineTable({
    backend: v.literal("vercel-connect"),
    userId: v.id("users"),
    app: appValidator,
    login: v.string(),
    providerUserId: v.string(),
    connect: connectReferenceValidator,
    grantedScopes: v.array(v.string()),
    grantVersion: v.number(),
  }).index("by_user_app_providerUserId", ["userId", "app", "providerUserId"]),
  oauthStates: defineTable({
    userId: v.id("users"),
    app: appValidator,
    state: v.string(),
    connectSubjectId: v.string(),
    browserProofHash: v.string(),
    returnTo: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
});
