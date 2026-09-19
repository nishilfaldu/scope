"use client";

import { useCallback, useMemo, useState } from "react";
import { ConvexError } from "convex/values";
import { useMutation } from "convex/react";
import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";

import { toast } from "@/components/ui/toast";

function getErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as unknown;
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message: unknown }).message === "string"
    ) {
      return (data as { message: string }).message;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Something went wrong";
}

type MutationOptions<M extends FunctionReference<"mutation">> = {
  onSuccess?: (
    result: FunctionReturnType<M>,
    ...args: OptionalRestArgs<M>
  ) => void;
  successMessage?: string | ((...args: OptionalRestArgs<M>) => string);
};

export function useErrorCatchingMutation<
  Mutation extends FunctionReference<"mutation">,
>(
  mutation: Mutation,
  options?: MutationOptions<Mutation>,
): [
  (
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation> | undefined>,
  boolean,
] {
  const mutate = useMutation(mutation);
  const [inFlightCount, setInFlightCount] = useState(0);
  const onSuccess = options?.onSuccess;
  const successMessage = options?.successMessage;

  const fn = useCallback(
    async (...args: OptionalRestArgs<Mutation>) => {
      setInFlightCount((count) => count + 1);
      try {
        const result = await mutate(...args);
        const message =
          typeof successMessage === "function"
            ? successMessage(...args)
            : successMessage;
        if (message) {
          toast.add({ title: message, type: "success" });
        }
        onSuccess?.(result, ...args);
        return result;
      } catch (error) {
        toast.add({ title: getErrorMessage(error), type: "error" });
        return undefined;
      } finally {
        setInFlightCount((count) => count - 1);
      }
    },
    [mutate, onSuccess, successMessage],
  );

  const isLoading = inFlightCount > 0;
  return useMemo(() => [fn, isLoading], [fn, isLoading]);
}
