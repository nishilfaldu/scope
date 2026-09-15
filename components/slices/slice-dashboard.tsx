"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { SliceListCard } from "@/components/slices/slice-list-card";

export function SliceDashboard() {
  return (
    <BoardShell title="Slices">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <SliceListCard />
        </div>
      </div>
    </BoardShell>
  );
}
