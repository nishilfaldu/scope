"use client";

import { useNow } from "@/hooks/use-now";

import Link from "next/link";
import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { PassportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { Id } from "@/convex/_generated/dataModel";
import { AccountBindings, bindingsFor } from "@/components/connections/account-bindings";
import type { AppId } from "@/lib/capabilities";
import { api } from "@/convex/_generated/api";
import { GoogleMark } from "@/components/auth/google-mark";
import { BoardShell } from "@/components/layout/board-shell";
import { ContentCard } from "@/components/shared/content-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_LABELS, formatRemaining } from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

function ApprovalGate({ publicToken }: { publicToken: string }) {
  const { signIn } = useAuthActions();
  const summary = useQuery(api.tables.slices.accessRequestPublic.publicSummary, {
    publicToken,
  });
  const now = useNow();
  const redirectTo = `/approvals/${publicToken}`;

  if (summary === undefined) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
        <Skeleton className="h-56 w-full max-w-sm" />
      </div>
    );
  }

  if (summary === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle>Link unavailable</CardTitle>
            <CardDescription>
              This approval link is invalid or has been removed. Ask the agent
              for a new one.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const expired = summary.status === "expired" || summary.expiresAt <= now;
  const decided =
    summary.status === "approved" ||
    summary.status === "denied" ||
    summary.status === "claimed";

  const appsLabel =
    summary.kind === "onboarding"
      ? (summary.apps ?? [])
          .map((app) => APP_LABELS[app] ?? app)
          .join(", ") || "apps"
      : summary.app
        ? (APP_LABELS[summary.app] ?? summary.app)
        : "an app";

  const agentLabel = summary.agentName?.trim() || "An agent";

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center justify-items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HugeiconsIcon
              icon={PassportIcon}
              strokeWidth={2}
              className="size-5"
            />
          </div>
          <div className="flex flex-col gap-1">
            <CardTitle className="text-xl">
              {expired
                ? "This link expired"
                : decided
                  ? "Already handled"
                  : "Continue to approve"}
            </CardTitle>
            <CardDescription>
              {expired
                ? "Ask the agent for a fresh approval link."
                : decided
                  ? `This request is ${summary.status}. Sign in only if you need the board inbox.`
                  : `${agentLabel} is requesting access to ${appsLabel}. Sign in to review and approve — secrets stay out of chat.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!expired && summary.kind === "onboarding" && summary.reason ? (
            <p className="text-center text-sm text-muted-foreground">
              Reason: {summary.reason}
            </p>
          ) : null}
          {!expired && !decided ? (
            <p className="text-center text-xs text-muted-foreground">
              Expires {formatRemaining(summary.expiresAt, now)}
            </p>
          ) : null}
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => void signIn("google", { redirectTo })}
          >
            <GoogleMark />
            {expired || decided
              ? "Sign in to Agent Passport"
              : "Continue with Google"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SignedInApproval({ publicToken }: { publicToken: string }) {
  const bound = useQuery(api.tables.slices.accessRequests.getByPublicToken, {
    publicToken,
  });
  const [decide, isDeciding] = useErrorCatchingMutation(
    api.tables.slices.accessRequests.decide,
  );
  const statuses = useQuery(api.tables.connections.queries.listStatuses);
  const [selected, setSelected] = useState<Partial<Record<AppId, Id<"connections">>>>({});
  const now = useNow();
  const request = bound;

  return (
    <BoardShell title="Approve access">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          {request === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : request === null || request === undefined ? (
            <ContentCard title="Request not found">
              <div className="p-6">
                <EmptyState
                  title="Unknown or unavailable request"
                  description="This approval link is invalid, expired, or belongs to another account. Ask the agent for a new link if you still need access."
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
          ) : request.status === "expired" || request.expiresAt <= now ? (
            <ContentCard title="Link expired">
              <div className="space-y-4 p-6">
                <EmptyState
                  title="This approval link expired"
                  description="Ask the agent to create a new access request and open the fresh link."
                />
                <Link
                  href="/approvals"
                  className="text-sm underline-offset-4 hover:underline"
                >
                  Back to inbox
                </Link>
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
                      <p>
                        Requested TTL: {Math.round(request.ttlMs / 60000)} min
                      </p>
                    ) : null}
                    {request.reason ? <p>Reason: {request.reason}</p> : null}
                    <p>
                      Need the apps connected first?{" "}
                      <Link
                        href="/connections"
                        className="underline-offset-4 hover:underline"
                      >
                        Open connections
                      </Link>
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {request.app ? (
                      <Badge variant="secondary">
                        {APP_LABELS[request.app]}
                      </Badge>
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
                {request.kind === "onboarding" && request.status === "pending" ? <AccountBindings apps={request.apps ?? []} statuses={statuses} selected={selected} onChange={(app, id) => setSelected((current) => ({ ...current, [app]: id }))} /> : null}
                <p className="text-sm text-muted-foreground">
                  Expires {formatRemaining(request.expiresAt, now)}
                </p>
                {request.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button
                      disabled={isDeciding || (request.kind === "onboarding" && bindingsFor(request.apps ?? [], statuses, selected).length !== (request.apps ?? []).length)}
                      onClick={() =>
                        void decide({
                          requestId: request._id,
                          decision: "approved",
                          bindings: request.kind === "onboarding" ? bindingsFor(request.apps ?? [], statuses, selected) : undefined,
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
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This request is already{" "}
                    <span className="font-medium">{request.status}</span>.
                    {request.status === "approved"
                      ? " The agent can claim over HTTPS."
                      : null}
                  </p>
                )}
              </div>
            </ContentCard>
          )}
        </div>
      </div>
    </BoardShell>
  );
}

export function ApprovalDetail({ publicToken }: { publicToken: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
        <Skeleton className="h-56 w-full max-w-sm" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <ApprovalGate publicToken={publicToken} />;
  }

  return <SignedInApproval publicToken={publicToken} />;
}
