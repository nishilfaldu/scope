"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { AiChat02Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BoardShell } from "@/components/layout/board-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { BrandMark } from "@/components/shared/brand-mark";
import { useNow } from "@/hooks/use-now";
import { handoffLabel } from "@/lib/capabilities";

function statusVariant(status: "staged" | "active" | "revoked" | "expired") {
  return status === "active"
    ? "default"
    : status === "revoked"
      ? "destructive"
      : "outline";
}

function AgentGrants({
  agentConnectionId,
}: {
  agentConnectionId: Id<"agentConnections">;
}) {
  const now = useNow();
  const { results, status, loadMore } = usePaginatedQuery(
    api.tables.agentDashboard.grantsPage,
    { agentConnectionId, now },
    { initialNumItems: 20 },
  );

  return (
    <div className="border-t bg-muted/25 px-4 py-2 sm:px-5">
      {status === "LoadingFirstPage" ? (
        <Skeleton className="my-3 h-8 w-full" />
      ) : results.length ? (
        results.map((slice) => (
          <Link
            key={slice._id}
            href={`/slices/${slice._id}`}
            className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-8 items-center justify-center rounded-lg border bg-background">
              <HugeiconsIcon
                icon={AiChat02Icon}
                className="size-4"
                strokeWidth={2}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {slice.name}
            </span>
            <Badge variant={statusVariant(slice.status)}>{slice.status}</Badge>
            <span className="hidden text-xs text-muted-foreground sm:block">
              {new Date(slice.expiresAt).toLocaleDateString()}
            </span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </Link>
        ))
      ) : (
        <p className="px-2 py-3 text-sm text-muted-foreground">
          No access granted yet.
        </p>
      )}
      {status === "CanLoadMore" ? (
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          onClick={() => loadMore(20)}
        >
          Load more grants
        </Button>
      ) : null}
    </div>
  );
}

export function AgentsBoard() {
  const now = useNow();
  const {
    results: activeResults,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.tables.agentDashboard.activePage,
    {},
    { initialNumItems: 50 },
  );
  const historical = useQuery(api.tables.agentDashboard.list, { now });
  const agents = [
    ...activeResults,
    ...(historical ?? []).filter((row) => row.status !== "active"),
  ];
  const revoke = useMutation(api.tables.agentConnections.revoke);
  const [busy, setBusy] = useState<Id<"agentConnections"> | null>(null);

  async function revokeAgent(id: Id<"agentConnections">) {
    setBusy(id);
    try {
      await revoke({ agentConnectionId: id });
    } finally {
      setBusy(null);
    }
  }

  const activeAgents = activeResults.length;

  return (
    <BoardShell title="Agents">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 lg:px-8 lg:py-10">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Connected agents and the access you granted to each one.
            </p>
          </div>
          {pageStatus !== "LoadingFirstPage" ? (
            <div className="flex gap-6 text-sm">
              <div>
                <span className="block text-2xl font-semibold tabular-nums">
                  {activeAgents}
                </span>
                <span className="text-muted-foreground">
                  Active agents shown
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border bg-card">
          {pageStatus === "LoadingFirstPage" ? (
            <div className="divide-y">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-center gap-4 p-5">
                  <Skeleton className="size-10 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          ) : agents.length === 0 ? (
            <EmptyState
              title="No connected agents"
              description="Open a connection link from an agent to connect it to Scope."
              icon={<BrandMark className="size-6" />}
            />
          ) : (
            <div className="divide-y">
              {agents.map((agent) => (
                <section key={agent._id}>
                  <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-xs font-semibold text-background">
                      {agent.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-semibold">{agent.name}</h2>
                        <Badge
                          variant={
                            agent.status === "active" ? "secondary" : "outline"
                          }
                        >
                          {agent.status === "staged"
                            ? handoffLabel(
                                agent.handoffStatus ?? "waiting_for_pickup",
                              )
                            : agent.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {agent.status === "staged" && agent.handoffDeadlineAt
                          ? `Completion deadline ${new Date(agent.handoffDeadlineAt).toLocaleString()}`
                          : agent.revocationReason
                            ? `Cause: ${agent.revocationReason.replaceAll("_", " ")}`
                            : agent.lastUsedAt
                              ? `Last used ${new Date(agent.lastUsedAt).toLocaleString()}`
                              : "Not used yet"}
                      </p>
                    </div>
                    {agent.status === "active" || agent.status === "staged" ? (
                      <Dialog>
                        <DialogTrigger
                          render={<Button size="sm" variant="outline" />}
                        >
                          Revoke
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Revoke {agent.name}?</DialogTitle>
                            <DialogDescription>
                              This also stops token requests through every grant
                              connected to this agent.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose
                              render={
                                <Button
                                  variant="outline"
                                  disabled={busy === agent._id}
                                />
                              }
                            >
                              Cancel
                            </DialogClose>
                            <Button
                              variant="destructive"
                              disabled={busy === agent._id}
                              onClick={() => void revokeAgent(agent._id)}
                            >
                              {busy === agent._id
                                ? "Revoking…"
                                : "Revoke agent"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    ) : null}
                  </div>
                  {agent.status !== "staged" ? (
                    <AgentGrants agentConnectionId={agent._id} />
                  ) : null}
                </section>
              ))}
            </div>
          )}
        </div>
        {pageStatus === "CanLoadMore" ? (
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => loadMore(50)}
          >
            Load more agents
          </Button>
        ) : null}
      </div>
    </BoardShell>
  );
}
