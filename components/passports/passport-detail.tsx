"use client";

import { useQuery } from "convex/react";
import { PassportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { PassportHistory } from "@/components/passports/passport-history";
import { PassportOverview } from "@/components/passports/passport-overview";
import { Skeleton } from "@/components/ui/skeleton";

export function PassportDetail({ passportId }: { passportId: string }) {
  const passport = useQuery(api.tables.passports.queries.get, { passportId });

  if (passport === undefined) {
    return (
      <BoardShell title="Passport" crumbs={[{ label: "Passports", href: "/" }]}>
        <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="flex flex-col gap-3 px-4 lg:px-6">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </BoardShell>
    );
  }

  if (passport === null) {
    return (
      <BoardShell title="Not found" crumbs={[{ label: "Passports", href: "/" }]}>
        <div className="@container/main flex flex-1 flex-col py-4 md:py-6">
          <div className="px-4 lg:px-6">
            <EmptyState
              title="Passport not found"
              description="This card may have been deleted from the deployment, or the link is invalid."
              icon={<HugeiconsIcon icon={PassportIcon} strokeWidth={2} />}
            />
          </div>
        </div>
      </BoardShell>
    );
  }

  return (
    <BoardShell
      title={passport.name}
      crumbs={[{ label: "Passports", href: "/" }]}
    >
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <PassportOverview passportId={passportId} />
        </div>
        <div className="px-4 lg:px-6">
          <PassportHistory passportId={passportId} />
        </div>
      </div>
    </BoardShell>
  );
}
