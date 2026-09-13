"use client";

import { Button } from "@/components/ui/button";

export function LoadMoreRow({
  status,
  onLoadMore,
}: {
  status: string;
  onLoadMore: () => void;
}) {
  if (status !== "CanLoadMore" && status !== "LoadingMore") {
    return null;
  }
  return (
    <div className="flex justify-center border-t p-4">
      <Button
        variant="outline"
        size="sm"
        disabled={status === "LoadingMore"}
        onClick={onLoadMore}
      >
        {status === "LoadingMore" ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
