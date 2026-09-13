"use client";

import { useCallback, useState } from "react";

/**
 * Explicit Convex cursor pagination: one page at a time with a Previous stack.
 * Page 0 uses cursor null; Next pushes the current cursor and advances to
 * continueCursor; Previous pops.
 */
export function useCursorPagination(pageSize: number) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);

  const paginationOpts = { numItems: pageSize, cursor };
  const canPrevious = cursorStack.length > 0;

  const reset = useCallback(() => {
    setCursor(null);
    setCursorStack([]);
  }, []);

  const goNext = useCallback(
    (continueCursor: string) => {
      setCursorStack((stack) => [...stack, cursor]);
      setCursor(continueCursor);
    },
    [cursor],
  );

  const goPrevious = useCallback(() => {
    setCursorStack((stack) => {
      if (stack.length === 0) {
        return stack;
      }
      const nextStack = [...stack];
      const previousCursor = nextStack.pop() ?? null;
      setCursor(previousCursor);
      return nextStack;
    });
  }, []);

  return {
    paginationOpts,
    canPrevious,
    reset,
    goNext,
    goPrevious,
  };
}
