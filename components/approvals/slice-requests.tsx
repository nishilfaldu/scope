"use client";

import { useNow } from "@/hooks/use-now";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { ContentCard } from "@/components/shared/content-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_LABELS, formatRelativeTime } from "@/lib/capabilities";

const STATUS_VARIANT = {
  pending: "secondary",
  approved: "secondary",
  denied: "destructive",
  expired: "outline",
  claimed: "outline",
} as const;

export function SliceRequests({ sliceId }: { sliceId: string }) {
  const requests = useQuery(api.tables.slices.accessRequests.listForSlice, {
    sliceId,
  });
  const now = useNow();

  if (requests === undefined) {
    return <Skeleton className="h-28 w-full" />;
  }

  if (requests.length === 0) {
    return null;
  }

  return (
    <ContentCard
      title="Recent credential requests"
      description="Approval-gated mint history for this slice."
    >
      <ul className="divide-y">
        {requests.map((request) => {
          const status = request.expiresAt <= now &&
            (request.status === "pending" || request.status === "approved")
            ? "expired" : request.status;
          return (
          <li
            key={request._id}
            className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {request.kind === "onboarding"
                  ? (request.sliceName ?? "Onboarding")
                  : request.app
                    ? (APP_LABELS[request.app] ?? request.app)
                    : "Mint"}
              </span>
              <Badge variant="outline">{request.kind}</Badge>
              <Badge variant={STATUS_VARIANT[status]}>
                {status}
              </Badge>
            </div>
            <span className="text-muted-foreground">
              {formatRelativeTime(request._creationTime, now)}
            </span>
          </li>
          );
        })}
      </ul>
    </ContentCard>
  );
}
