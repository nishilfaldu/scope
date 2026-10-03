"use client";
import { useState } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { Button } from "@/components/ui/button";
import { RequestRow } from "./request-row";
import { useNow } from "@/hooks/use-now";
import {
  approvalStatus,
  type ApprovalAccount,
  type ApprovalRequest,
} from "@/lib/approval-display";
import styles from "@/components/scope/scope.module.css";
export function ApprovalsBoard({ requestId }: { requestId?: string }) {
  const now = useNow();
  const [decided, setDecided] = useState<Record<string, ApprovalRequest>>({});
  const [order, setOrder] = useState<string[]>([]);
  const retained = useQuery(
    api.probe.retainedForOwner,
    Object.keys(decided).length
      ? { ids: Object.values(decided).map((r) => r._id) }
      : "skip",
  );
  const accounts = useQuery(api.probe.accountsForOwner, {}) as
    ApprovalAccount[] | undefined;
  const pendingRows = useQuery(api.probe.pendingForOwner, { now });
  const page = usePaginatedQuery(
    api.probe.requestsForOwner,
    {},
    { initialNumItems: 20 },
  );
  const focused = useQuery(
    api.probe.requestForOwner,
    requestId ? { reference: requestId } : "skip",
  );
  const rows = [
    ...(pendingRows ?? []),
    ...page.results,
    ...Object.values(decided),
    ...(retained ?? []),
  ] as ApprovalRequest[];
  if (focused) rows.push(focused.request);
  const unique = [...new Map(rows.map((r) => [r._id, r])).values()];
  if (order.length)
    unique.sort((a, b) => {
      const rank = (r: ApprovalRequest) => {
        const index = order.indexOf(r._id);
        return index >= 0 ? index : r.status === "pending" ? -1 : order.length;
      };
      return rank(a) - rank(b);
    });
  const accountFor = (r: ApprovalRequest) =>
    focused?.request._id === r._id
      ? (focused.account ?? undefined)
      : accounts?.find((a) => a._id === r.accountId);
  const pending = unique.filter(
    (r) => approvalStatus(r, now, accountFor(r)?.revoked) === "Needs approval",
  ).length;
  const loading =
    !accounts || !pendingRows || page.status === "LoadingFirstPage";
  return (
    <BoardShell title="Requests">
      <header className={styles.pageHeading}>
        <h1>Requests</h1>
        <p>
          {loading
            ? "Loading your requests…"
            : pending
              ? `${pending} request${pending === 1 ? " needs" : "s need"} your decision.`
              : "No requests need your approval."}
        </p>
      </header>
      {requestId && focused === null && (
        <p role="status" className={styles.notice}>
          That request is unavailable. Your requests are shown below.
        </p>
      )}
      <div className={styles.requestList} aria-label="Access requests">
        {loading || (requestId && focused === undefined) ? (
          <p className={styles.loading}>Loading requests…</p>
        ) : !unique.length ? (
          <p className={styles.empty}>
            When an agent asks for access, you can review it here.
          </p>
        ) : (
          unique.map((r) => (
            <RequestRow
              key={r._id}
              request={r}
              account={accountFor(r)}
              now={now}
              focused={focused?.request._id === r._id}
              onDecision={() => {
                setOrder(unique.map((row) => row._id));
                setDecided((previous) =>
                  Object.fromEntries(
                    Object.entries({ ...previous, [r._id]: r }).slice(-100),
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
          {page.status === "LoadingMore" ? "Loading…" : "Load earlier requests"}
        </Button>
      ) : (
        !loading && <p className={styles.endNote}>That’s everything for now.</p>
      )}
    </BoardShell>
  );
}
