"use client";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
} from "@/components/ui/pagination";

export function ConvexPagination({
  status,
  onLoadMore,
}: {
  status: string;
  onLoadMore: () => void;
}) {
  const canLoadMore = status === "CanLoadMore";
  const loadingMore = status === "LoadingMore";
  if (!canLoadMore && !loadingMore) {
    return null;
  }

  return (
    <Pagination className="justify-end px-4 py-3">
      <PaginationContent>
        <PaginationItem>
          <PaginationNext
            href="#"
            text={loadingMore ? "Loading…" : "Next"}
            aria-disabled={!canLoadMore}
            className={!canLoadMore ? "pointer-events-none opacity-50" : undefined}
            onClick={(event) => {
              event.preventDefault();
              if (canLoadMore) onLoadMore();
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
