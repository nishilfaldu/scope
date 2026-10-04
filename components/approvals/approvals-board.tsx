"use client";
import { useEffect } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BoardSkeleton } from "@/components/layout/workspace-skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { RequestRow } from "./request-row";
import { usePendingRequests } from "./pending-requests-provider";
import type { ApprovalRequest } from "@/lib/approval-display";
import styles from "@/components/scope/scope.module.css";
export function ApprovalsBoard({ requestId }: { requestId?: string }) {
  const { count } = usePendingRequests();
  const focused = useQuery(
    api.access.requestForOwner,
    requestId ? { reference: requestId } : "skip",
  );
  useEffect(() => {
    if (requestId && focused === null)
      toast.add({
        id: `unavailable-request-${requestId}`,
        title: "That approval is unavailable. Your other approvals are shown.",
        type: "error",
        priority: "high",
      });
  }, [requestId, focused]);
  return (
    <>
      <header className={styles.pageHeading}>
        <h1>Access</h1>
        <p>
          {count === undefined
            ? "Allow token requests for a limited time."
            : count
              ? `${count} request${count === 1 ? " needs" : "s need"} your decision.`
              : "No requests need your approval."}
        </p>
      </header>
      <AccessSection
        section="pending"
        title="Needs approval"
        focused={focused}
      />
      <AccessSection
        section="active"
        title="Active approvals"
        focused={focused}
      />
      <AccessSection section="history" title="History" focused={focused} />
    </>
  );
}
function AccessSection({
  section,
  title,
  focused,
}: {
  section: "pending" | "active" | "history";
  title: string;
  focused?: ApprovalRequest | null;
}) {
  const page = usePaginatedQuery(
    api.access.forOwner,
    { section },
    { initialNumItems: 20 },
  );
  const rows =
    focused?.section === section &&
    !page.results.some((r) => r._id === focused._id)
      ? [focused, ...page.results]
      : page.results;
  return (
    <section className={styles.accessSection} aria-label={title}>
      <h2>{title}</h2>
      <div className={styles.requestList}>
        {page.status === "LoadingFirstPage" ? (
          <BoardSkeleton kind="access" />
        ) : rows.length ? (
          rows.map((r) => (
            <RequestRow
              key={r._id}
              request={r}
              focused={focused?._id === r._id}
            />
          ))
        ) : (
          <p className={styles.empty}>
            {section === "pending"
              ? "No requests waiting."
              : section === "active"
                ? "No active approvals."
                : "Past approvals will appear here."}
          </p>
        )}
      </div>
      {(page.status === "CanLoadMore" || page.status === "LoadingMore") && (
        <Button
          className="mt-4"
          variant="outline"
          disabled={page.status === "LoadingMore"}
          onClick={() => page.loadMore(20)}
        >
          {page.status === "LoadingMore" && (
            <span className={styles.spinner} aria-hidden />
          )}
          Load more
        </Button>
      )}
    </section>
  );
}
