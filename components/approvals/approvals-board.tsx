"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { RequestRow } from "./request-row";
import { useNow } from "@/hooks/use-now";
import {
  approvalStatus,
  requestTime,
  type ApprovalAccount,
  type ApprovalRequest,
} from "@/lib/approval-display";

export function ApprovalsBoard({ requestId }: { requestId?: string }) {
  const now = useNow();
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const accounts = useQuery(api.probe.accountsForOwner, {}) as
    ApprovalAccount[] | undefined;
  const page = usePaginatedQuery(
    api.probe.requestsForOwner,
    {},
    { initialNumItems: 20 },
  );
  const focused = useQuery(
    api.probe.requestForOwner,
    requestId ? { reference: requestId } : "skip",
  );
  const accountFor = (r: ApprovalRequest) =>
    r._id === requestId && focused
      ? (focused.account ?? undefined)
      : accounts?.find((a) => a._id === r.accountId);
  const rows = [...page.results] as ApprovalRequest[];
  if (focused && !rows.some((r) => r._id === focused.request._id))
    rows.push(focused.request);
  const pending = (r: ApprovalRequest) =>
    approvalStatus(r, now, accountFor(r)?.revoked) === "Needs approval";
  const visible = rows
    .filter((r) => filter === "all" || pending(r) || r._id === requestId)
    .sort(
      (a, b) =>
        Number(pending(b)) - Number(pending(a)) ||
        (requestTime(b, now) ?? 0) - (requestTime(a, now) ?? 0),
    );
  const loading = !accounts || page.status === "LoadingFirstPage";
  return (
    <BoardShell title="Approvals">
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-7 lg:px-8 lg:py-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Decide what your agents can access.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/notifications" />}
          >
            Notifications
          </Button>
        </header>
        <div
          className="mb-4 mt-7 flex gap-2"
          role="group"
          aria-label="Filter requests"
        >
          <Button
            size="sm"
            variant={filter === "all" ? "secondary" : "ghost"}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All requests
          </Button>
          <Button
            size="sm"
            variant={filter === "pending" ? "secondary" : "ghost"}
            aria-pressed={filter === "pending"}
            onClick={() => setFilter("pending")}
          >
            Needs approval
          </Button>
        </div>
        {requestId && focused === null && (
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            That request is unavailable. Your requests are shown below.
          </p>
        )}
        <div className="overflow-hidden rounded-xl border bg-card">
          {loading || (requestId && focused === undefined) ? (
            <div aria-label="Loading requests" className="space-y-5 p-5">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : !visible.length ? (
            <EmptyState
              title={
                filter === "pending"
                  ? page.status === "Exhausted"
                    ? "No requests need your approval"
                    : "No requests need approval here"
                  : "No requests yet"
              }
              description={
                filter === "pending"
                  ? page.status === "Exhausted"
                    ? "You can review previous decisions in All requests."
                    : "Load earlier requests to check more of your history."
                  : "When an agent asks for access, you can review it here."
              }
            />
          ) : (
            <div className="divide-y">
              {visible.map((r) => (
                <RequestRow
                  key={r._id}
                  request={r}
                  account={accountFor(r)}
                  now={now}
                  focused={r._id === requestId}
                />
              ))}
            </div>
          )}
        </div>
        {(page.status === "CanLoadMore" || page.status === "LoadingMore") && (
          <Button
            className="mt-4"
            variant="outline"
            disabled={page.status === "LoadingMore"}
            onClick={() => page.loadMore(20)}
          >
            {page.status === "LoadingMore"
              ? "Loading…"
              : "Load earlier requests"}
          </Button>
        )}
      </div>
    </BoardShell>
  );
}
