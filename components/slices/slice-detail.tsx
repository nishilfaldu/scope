"use client";

import { useQuery } from "convex/react";
import { PassportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { SliceOverview } from "@/components/slices/slice-overview";
import { Skeleton } from "@/components/ui/skeleton";

export function SliceDetail({ sliceId }: { sliceId: string }) {
  const slice = useQuery(api.tables.slices.queries.get, { sliceId: sliceId });

  if (slice === undefined) {
    return (
      <BoardShell title="Slice" crumbs={[{ label: "Slices", href: "/" }]}>
        <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="flex flex-col gap-3 px-4 lg:px-6">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </BoardShell>
    );
  }

  if (slice === null) {
    return (
      <BoardShell title="Not found" crumbs={[{ label: "Slices", href: "/" }]}>
        <div className="@container/main flex flex-1 flex-col py-4 md:py-6">
          <div className="px-4 lg:px-6">
            <EmptyState
              title="Slice not found"
              icon={<HugeiconsIcon icon={PassportIcon} strokeWidth={2} />}
            />
          </div>
        </div>
      </BoardShell>
    );
  }

  return (
    <BoardShell title={slice.name} crumbs={[{ label: "Slices", href: "/" }]}>
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <SliceOverview sliceId={sliceId} />
        </div>
      </div>
    </BoardShell>
  );
}
