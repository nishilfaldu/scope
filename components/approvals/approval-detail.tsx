"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { ContentCard } from "@/components/shared/content-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_LABELS, formatRemaining } from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

export function ApprovalDetail({ publicToken }: { publicToken: string }) {
  const bound = useQuery(api.tables.slices.accessRequests.getByPublicToken, {
    publicToken,
  });
  const bindToViewer = useMutation(api.tables.slices.accessRequests.bindToViewer);
  const [decide, isDeciding] = useErrorCatchingMutation(
    api.tables.slices.accessRequests.decide,
  );
  const [now] = useState(() => Date.now());
  const [binding, setBinding] = useState(false);
  const [boundRequest, setBoundRequest] = useState<typeof bound>(undefined);

  useEffect(() => {
    let cancelled = false;
    setBinding(true);
    void bindToViewer({ publicToken })
      .then((result) => {
        if (!cancelled) setBoundRequest(result);
      })
      .finally(() => {
        if (!cancelled) setBinding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bindToViewer, publicToken]);

  const request = boundRequest ?? bound;

  return (
    <BoardShell title="Approve access">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          {binding && request === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : request === null || request === undefined ? (
            <ContentCard title="Request not found">
              <div className="p-6">
                <EmptyState
                  title="Unknown or unavailable request"
                  description="This approval link is invalid, expired, or belongs to another account."
                />
                <div className="mt-4">
                  <Link
                    href="/approvals"
                    className="text-sm underline-offset-4 hover:underline"
                  >
                    Back to inbox
                  </Link>
                </div>
              </div>
            </ContentCard>
          ) : (
            <ContentCard
              title={
                request.kind === "onboarding"
                  ? "Agent access request"
                  : "Credential mint request"
              }
              description={
                request.kind === "onboarding"
                  ? "Approving creates a slice for this agent. The agent claims slice credentials over HTTPS — secrets never appear in chat."
                  : "Approving lets the agent claim a short-lived provider token for this slice."
              }
            >
              <div className="space-y-4 p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{request.sliceName}</span>
                  <Badge variant="secondary">{request.status}</Badge>
                  <Badge variant="outline">{request.kind}</Badge>
                </div>
                {request.kind === "onboarding" ? (
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Apps:{" "}
                      {(request.apps ?? [])
                        .map((app) => APP_LABELS[app] ?? app)
                        .join(", ") || "—"}
                    </p>
                    {request.ttlMs ? (
                      <p>Requested TTL: {Math.round(request.ttlMs / 60000)} min</p>
                    ) : null}
                    {request.reason ? <p>Reason: {request.reason}</p> : null}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {request.app ? (
                      <Badge variant="secondary">
                        {APP_LABELS[request.app]}
                      </Badge>
                    ) : null}
                    {request.refresh ? (
                      <Badge variant="outline">refresh</Badge>
                    ) : null}
                    {request.sliceId ? (
                      <Link
                        href={`/slices/${request.sliceId}`}
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        Open slice
                      </Link>
                    ) : null}
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Expires {formatRemaining(request.expiresAt, now)}
                </p>
                {request.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button
                      disabled={isDeciding}
                      onClick={() =>
                        void decide({
                          requestId: request._id,
                          decision: "approved",
                        })
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      disabled={isDeciding}
                      onClick={() =>
                        void decide({
                          requestId: request._id,
                          decision: "denied",
                        })
                      }
                    >
                      Deny
                    </Button>
                  </div>
                ) : null}
              </div>
            </ContentCard>
          )}
        </div>
      </div>
    </BoardShell>
  );
}
