"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { PassportListCard } from "@/components/passports/passport-list-card";

export function PassportDashboard() {
  return (
    <BoardShell title="Passports">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <PassportListCard />
        </div>
      </div>
    </BoardShell>
  );
}
