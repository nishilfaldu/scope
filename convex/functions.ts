import { getAuthUserId } from "@convex-dev/auth/server";
import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  mutation as rawMutation,
  query as rawQuery,
} from "./_generated/server";

async function authenticatedContext(ctx: QueryCtx | MutationCtx) {
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
