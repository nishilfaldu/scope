"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { PassportListCard } from "@/components/passports/passport-list-card";
import { PassportSummaryCard } from "@/components/passports/passport-summary-card";

export function PassportDashboard() {
  const passports = useQuery(api.tables.passports.queries.list, {});
  const activeCount =
    passports === undefined
      ? undefined
      : passports.filter((passport) => passport.status === "active").length;

  return (
    <BoardShell title="Passports">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <PassportSummaryCard activeCount={activeCount} />
        </div>

        <div className="px-4 lg:px-6">
          <PassportListCard passports={passports} />
        </div>
      </div>
    </BoardShell>
  );
}
