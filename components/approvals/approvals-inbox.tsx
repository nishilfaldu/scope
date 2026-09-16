"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Notification01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { ContentCard } from "@/components/shared/content-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_LABELS, formatRemaining } from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

export function ApprovalsInbox() {
  const pending = useQuery(api.tables.slices.accessRequests.listPending);
  const [decide, isDeciding] = useErrorCatchingMutation(
    api.tables.slices.accessRequests.decide,
  );
  const [now] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <BoardShell title="Approvals">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <ContentCard
            title="Credential requests"
            description="Approve or deny agent mint requests for slices with mint policy Approve. Tokens are minted only when the agent claims after you approve."
          >
            {pending === undefined ? (
              <div className="space-y-3 p-6">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : pending.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No pending approvals"
                  description="When an agent requests a credential on an approve-gated slice, it shows up here."
                  icon={
                    <HugeiconsIcon icon={Notification01Icon} strokeWidth={2} />
                  }
                />
              </div>
            ) : (
              <ul className="divide-y">
                {pending.map((request) => (
                  <li
                    key={request._id}
                    className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/slices/${request.sliceId}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {request.sliceName}
                        </Link>
                        <Badge variant="secondary">
                          {APP_LABELS[request.app]}
                        </Badge>
                        {request.refresh ? (
                          <Badge variant="outline">refresh</Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Expires {formatRemaining(request.expiresAt, now)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={isDeciding || busyId === request._id}
                        onClick={() => {
                          setBusyId(request._id);
                          void decide({
                            requestId: request._id,
                            decision: "approved",
                          }).finally(() => setBusyId(null));
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isDeciding || busyId === request._id}
                        onClick={() => {
                          setBusyId(request._id);
                          void decide({
                            requestId: request._id,
                            decision: "denied",
                          }).finally(() => setBusyId(null));
                        }}
                      >
                        Deny
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ContentCard>
        </div>
      </div>
    </BoardShell>
  );
}
