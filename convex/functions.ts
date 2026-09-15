import { getAuthUserId } from "@convex-dev/auth/server";
import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import {
  action as rawAction,
  mutation as rawMutation,
  query as rawQuery,
} from "./_generated/server";

async function authenticatedContext(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Sign in to continue");
  }
  return { userId };
}

export const authenticatedQuery = customQuery(
  rawQuery,
  customCtx(authenticatedContext),
);

export const authenticatedMutation = customMutation(
  rawMutation,
  customCtx(authenticatedContext),
);

export const authenticatedAction = customAction(
  rawAction,
  customCtx(authenticatedContext),
);
