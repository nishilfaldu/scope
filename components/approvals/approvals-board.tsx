"use client";
import { useEffect, useState } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BoardSkeleton } from "@/components/layout/workspace-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { RequestRow } from "./request-row";
import { usePendingRequests } from "./pending-requests-provider";
import { approvalStatus, type ApprovalRequest } from "@/lib/approval-display";
import styles from "@/components/scope/scope.module.css";
export function ApprovalsBoard({ requestId }: { requestId?: string }) {
  const { now, rows: pendingRows } = usePendingRequests();
  const [decided, setDecided] = useState<Record<string, ApprovalRequest>>({});
  const [order, setOrder] = useState<string[]>([]);
  const retained = useQuery(
    api.approvals.retainedForOwner,
    Object.keys(decided).length
      ? { ids: Object.values(decided).map((r) => r._id) }
      : "skip",
  );
  const page = usePaginatedQuery(
    api.approvals.forOwner,
    {},
    { initialNumItems: 20 },
  );
  const focused = useQuery(
    api.approvals.requestForOwner,
    requestId ? { reference: requestId } : "skip",
  );
  useEffect(() => {
    if (requestId && focused === null) {
      toast.add({
        id: `unavailable-request-${requestId}`,
        title: "That request is unavailable. Your other requests are shown.",
        type: "error",
        priority: "high",
      });
    }
  }, [requestId, focused]);
  const rows = [
    ...(pendingRows ?? []),
    ...page.results,
    ...Object.values(decided),
    ...(retained ?? []),
  ] as ApprovalRequest[];
  if (focused) rows.push(focused);
  const unique = [...new Map(rows.map((r) => [r._id, r])).values()];
  if (order.length)
    unique.sort((a, b) => {
      const rank = (r: ApprovalRequest) => {
        const index = order.indexOf(r._id);
        return index >= 0 ? index : r.status === "pending" ? -1 : order.length;
      };
      return rank(a) - rank(b);
    });
  const pending = unique.filter(
    (r) => approvalStatus(r, now) === "Needs approval",
  ).length;
  const loading = !pendingRows || page.status === "LoadingFirstPage";
  return (
    <>
      <header className={styles.pageHeading}>
        <h1>Requests</h1>
        {loading ? (
          <Skeleton className="mt-3 h-4 w-60 rounded-md" />
        ) : (
          <p>
            {pending
              ? `${pending} request${pending === 1 ? " needs" : "s need"} your decision.`
              : "No requests need your approval."}
          </p>
        )}
      </header>
      <div className={styles.requestList} aria-label="Access requests">
        {loading || (requestId && focused === undefined) ? (
          <BoardSkeleton kind="requests" />
        ) : !unique.length ? (
          <p className={styles.empty}>
            When an agent asks for access, you can review it here.
          </p>
        ) : (
          unique.map((r) => (
            <RequestRow
              key={r._id}
              request={r}
              now={now}
              focused={focused?._id === r._id}
              onDecision={() => {
                setOrder(unique.map((row) => row._id));
                setDecided((previous) =>
                  Object.fromEntries(
                    Object.entries({ ...previous, [r._id]: r }).slice(-50),
                  ),
                );
              }}
            />
          ))
        )}
      </div>
      {page.status === "CanLoadMore" || page.status === "LoadingMore" ? (
        <Button
          className="mt-5"
          variant="outline"
          disabled={page.status === "LoadingMore"}
          onClick={() => page.loadMore(20)}
        >
          {page.status === "LoadingMore" && (
            <span className={styles.spinner} aria-hidden />
          )}
          Load earlier requests
        </Button>
      ) : (
        !loading && <p className={styles.endNote}>That’s everything for now.</p>
      )}
    </>
  );
}
