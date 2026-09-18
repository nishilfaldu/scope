"use client";

import { useNow } from "@/hooks/use-now";

import { useQuery } from "convex/react";
import { Notification01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import { ApprovalRow } from "@/components/approvals/approval-row";
import { BoardShell } from "@/components/layout/board-shell";
import { ContentCard } from "@/components/shared/content-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export function ApprovalsInbox({ requestToken }: { requestToken?: string }) {
  const pending = useQuery(api.tables.slices.accessRequests.listPending);
  const linked = useQuery(
    api.tables.slices.accessRequests.getByPublicToken,
    requestToken ? { publicToken: requestToken } : "skip",
  );
  const now = useNow();
  const livePending = pending?.filter((request) => request.expiresAt > now) ?? [];
  const requests = linked && !livePending.some((request) => request._id === linked._id)
    ? [linked, ...livePending] : livePending;

  return (
    <BoardShell title="Approvals">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <ContentCard title="Access requests">
            {pending === undefined || (requestToken && linked === undefined) ? (
              <div className="space-y-3 p-6">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : requestToken && linked === null ? (
              <div className="p-6">
                <EmptyState title="Request unavailable" description="This link is invalid or belongs to another account." />
              </div>
            ) : requests.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No pending approvals"
                  icon={
                    <HugeiconsIcon icon={Notification01Icon} strokeWidth={2} />
                  }
                />
              </div>
            ) : (
              <ul className="divide-y">
                {requests.map((request) => (
                  <ApprovalRow key={request._id} request={request} now={now}
                    initiallyOpen={request.publicToken === requestToken} />
                ))}
              </ul>
            )}
          </ContentCard>
        </div>
      </div>
    </BoardShell>
  );
}
