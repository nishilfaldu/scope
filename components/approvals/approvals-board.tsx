"use client";
import Link from "next/link";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { RequestCard } from "./request-card";
import { ApprovalHistory } from "./approval-history";
import { useNow } from "@/hooks/use-now";
import {
  approvalStatus,
  type ApprovalAccount,
  type ApprovalRequest,
} from "@/lib/approval-display";

export function ApprovalsBoard({
  requestId,
  history = false,
}: {
  requestId?: string;
  history?: boolean;
}) {
  const now = useNow();
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
  const requests = (page.results as ApprovalRequest[]).filter(
    (r) => r._id !== requestId,
  );
  const active = requests.filter((r) =>
    ["Needs approval", "Approved"].includes(
      approvalStatus(
        r,
        now,
        accounts?.find((a) => a._id === r.accountId)?.revoked,
      ),
    ),
  );
  const recent = requests.filter((r) => !active.includes(r));
  const loading = !accounts || page.status === "LoadingFirstPage";
  return (
    <BoardShell title="Approvals">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 lg:px-8 lg:py-10">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Your accounts. Your decision. Review each request before access is
              delivered.
            </p>
          </div>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/notifications" />}
          >
            Set up notifications
          </Button>
        </header>
        <nav
          aria-label="Approval views"
          className="mb-7 mt-7 flex gap-6 border-b text-sm"
        >
          <Link
            href="/approvals"
            aria-current={!history ? "page" : undefined}
            className={`border-b-2 pb-3 font-medium ${!history ? "border-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Requests
          </Link>
          <Link
            href="/approvals?view=history"
            aria-current={history ? "page" : undefined}
            className={`border-b-2 pb-3 font-medium ${history ? "border-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Delivery history
          </Link>
        </nav>
        {history ? (
          <ApprovalHistory accounts={accounts ?? []} />
        ) : (
          <div className="space-y-7">
            {requestId && (
              <section aria-label="Selected request" className="space-y-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Selected request
                </h2>
                {focused === undefined ? (
                  <Skeleton className="h-72 w-full" />
                ) : focused === null ? (
                  <div className="rounded-xl border bg-card">
                    <EmptyState
                      title="Request unavailable"
                      description="This link may be invalid or belong to another Scope account."
                      action={
                        <Button
                          variant="outline"
                          nativeButton={false}
                          render={<Link href="/approvals" />}
                        >
                          View your requests
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <RequestCard
                    request={focused.request}
                    account={focused.account ?? undefined}
                    now={now}
                    focused
                  />
                )}
              </section>
            )}
            {loading ? (
              <div aria-label="Loading requests" className="space-y-4">
                <Skeleton className="h-56 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : (
              <>
                <section className="space-y-4">
                  <h2 className="text-sm font-medium">Open requests</h2>
                  {active.length ? (
                    active.map((r) => (
                      <RequestCard
                        key={r._id}
                        request={r}
                        account={accounts.find((a) => a._id === r.accountId)}
                        now={now}
                      />
                    ))
                  ) : (
                    <div className="rounded-xl border bg-card">
                      <EmptyState
                        title={
                          page.status === "CanLoadMore"
                            ? "No open requests in this activity"
                            : "You’re all caught up"
                        }
                        description="New requests appear here when an agent asks for access. Enable notifications to review them on your phone."
                      />
                    </div>
                  )}
                </section>
                {!!recent.length && (
                  <section className="space-y-4">
                    <h2 className="text-sm font-medium">Recent decisions</h2>
                    {recent.map((r) => (
                      <details
                        key={r._id}
                        className="overflow-hidden rounded-xl border bg-card"
                      >
                        <summary className="flex cursor-pointer list-none flex-col justify-between gap-2 px-5 py-4 text-sm focus-visible:outline-2 focus-visible:outline-ring sm:flex-row sm:items-center">
                          <span className="min-w-0">
                            <span className="block break-words font-medium">
                              {accounts.find((a) => a._id === r.accountId)
                                ?.label ?? "Unavailable account"}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {new Date(
                                r.decidedAt ?? r.expiresAt,
                              ).toLocaleString()}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {approvalStatus(
                              r,
                              now,
                              accounts.find((a) => a._id === r.accountId)
                                ?.revoked,
                            )}{" "}
                            · View request
                          </span>
                        </summary>
                        <div className="border-t p-3">
                          <RequestCard
                            request={r}
                            account={accounts.find(
                              (a) => a._id === r.accountId,
                            )}
                            now={now}
                          />
                        </div>
                      </details>
                    ))}
                  </section>
                )}
                {(page.status === "CanLoadMore" ||
                  page.status === "LoadingMore") && (
                  <Button
                    variant="outline"
                    disabled={page.status === "LoadingMore"}
                    onClick={() => page.loadMore(20)}
                  >
                    {page.status === "LoadingMore"
                      ? "Loading…"
                      : "Load earlier requests"}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </BoardShell>
  );
}
