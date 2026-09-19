"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { BrandMark } from "@/components/shared/brand-mark";
import { SliceOverview } from "@/components/slices/slice-overview";
import { Skeleton } from "@/components/ui/skeleton";

const frame =
  "mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 lg:px-8 lg:py-10";

export function SliceDetail({ sliceId }: { sliceId: string }) {
  const slice = useQuery(api.tables.slices.queries.get, { sliceId });

  if (slice === undefined) {
    return (
      <BoardShell
        title="Access"
        crumbs={[{ label: "Agents", href: "/agents" }]}
      >
        <div className={frame}>
          <div className="space-y-6">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        </div>
      </BoardShell>
    );
  }
  if (slice === null) {
    return (
      <BoardShell
        title="Not found"
        crumbs={[{ label: "Agents", href: "/agents" }]}
      >
        <div className={frame}>
          <div className="rounded-xl border bg-card">
            <EmptyState
              title="Access grant not found"
              description="It may have been removed or belong to another Scope account."
              icon={<BrandMark className="size-6" />}
            />
          </div>
        </div>
      </BoardShell>
    );
  }
  return (
    <BoardShell
      title={slice.name}
      crumbs={[{ label: "Agents", href: "/agents" }]}
    >
      <div className={frame}>
        <SliceOverview sliceId={sliceId} />
      </div>
    </BoardShell>
  );
}
