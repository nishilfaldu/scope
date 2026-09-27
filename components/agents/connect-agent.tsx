"use client";

import { useState } from "react";
import {
  useConvexAuth,
  useMutation,
  useQuery,
  usePaginatedQuery,
} from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SignIn } from "@/components/auth/sign-in";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthorizationShell } from "@/components/shared/authorization-shell";
import { useNow } from "@/hooks/use-now";
import { handoffLabel } from "@/lib/capabilities";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DecisionFact,
  DecisionFacts,
  DecisionHeader,
} from "@/components/shared/decision-card";

export function ConnectAgent({ publicToken }: { publicToken: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const now = useNow();
  const invite = useQuery(
    api.tables.agentConnections.getInvite,
    isAuthenticated ? { publicToken, now } : "skip",
  );
  const {
    results: replacementOptions,
    status: optionsStatus,
    loadMore: loadMoreOptions,
  } = usePaginatedQuery(
    api.tables.agentConnections.replacementOptionsPage,
    isAuthenticated ? {} : "skip",
    { initialNumItems: 50 },
  );
  const decide = useMutation(api.tables.agentConnections.decideInvite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replacementId, setReplacementId] = useState<string>("new");
  const currentPath = `/connect/${publicToken}`;

  if (isLoading)
    return (
      <AuthorizationShell>
        <div className="space-y-5 p-8">
          <Skeleton className="size-14 rounded-2xl" />
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </AuthorizationShell>
    );
  if (!isAuthenticated) {
    return (
      <SignIn redirectTo={currentPath} title="Verify your email to connect" />
    );
  }
  if (invite === undefined)
    return (
      <AuthorizationShell>
        <div className="space-y-5 p-8">
          <Skeleton className="size-14 rounded-2xl" />
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-20 w-full" />
        </div>
      </AuthorizationShell>
    );
  if (invite === null) {
    return (
      <AuthorizationShell>
        <div className="px-8 py-12 text-center">
          <h1 className="text-xl font-semibold">Connection unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link is invalid, expired, or belongs to another Scope account.
          </p>
        </div>
      </AuthorizationShell>
    );
  }

  const pending = invite.handoffStatus === "waiting_for_approval";
  const resolvedInvite = invite;

  async function submit(decision: "approved" | "denied") {
    setBusy(true);
    setError("");
    try {
      await decide({
        publicToken,
        decision,
        replaceAgentConnectionId:
          decision === "approved" &&
          !resolvedInvite.reconnecting &&
          replacementId !== "new"
            ? (replacementId as Id<"agentConnections">)
            : undefined,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not decide this connection.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthorizationShell>
      <DecisionHeader
        title={invite.agentName}
        subtitle={
          invite.reconnecting
            ? "requests replacement credentials"
            : "wants to connect to Scope"
        }
        leading={
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-xs font-semibold text-background">
            {invite.agentName.slice(0, 2).toUpperCase()}
          </span>
        }
      />
      <div className="px-6 py-6 sm:px-8">
        <DecisionFacts>
          <DecisionFact label="Can do">
            Send access requests to your Scope account
          </DecisionFact>
          <DecisionFact label="Access">
            You still approve each app, account, and duration
          </DecisionFact>
          {invite.reconnecting ? (
            <DecisionFact label="Effect">
              The current credentials stay active until the replacement is
              claimed and activated
            </DecisionFact>
          ) : null}
        </DecisionFacts>
        {pending && !invite.reconnecting && replacementOptions.length > 0 ? (
          <div className="mt-6">
            <p className="text-sm text-muted-foreground">
              Connection destination
            </p>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                className={`rounded-xl px-4 py-3 text-left text-sm transition-colors ${replacementId === "new" ? "bg-primary/15 ring-1 ring-primary/40" : "bg-muted/60 hover:bg-muted"}`}
                onClick={() => setReplacementId("new")}
              >
                <span className="font-medium">Connect as a new agent</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Starts without existing grants.
                </span>
              </button>
              {replacementOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`rounded-xl px-4 py-3 text-left text-sm transition-colors ${replacementId === option.id ? "bg-primary/15 ring-1 ring-primary/40" : "bg-muted/60 hover:bg-muted"}`}
                  onClick={() => setReplacementId(option.id)}
                >
                  <span className="font-medium">Replace {option.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Keeps its existing grants after the new credentials
                    activate.
                  </span>
                </button>
              ))}
              {optionsStatus === "CanLoadMore" ? (
                <Button variant="outline" onClick={() => loadMoreOptions(50)}>
                  Load more connections
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mt-5">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <div className="border-t px-6 py-5 sm:px-8">
        {pending ? (
          <div className="flex gap-3">
            <Button
              className="h-11 flex-1"
              disabled={busy}
              onClick={() => void submit("approved")}
            >
              {busy
                ? "Working…"
                : invite.reconnecting
                  ? "Approve rotation"
                  : replacementId !== "new"
                    ? "Reconnect agent"
                    : "Connect agent"}
            </Button>
            <Button
              variant="outline"
              className="h-11 flex-1"
              disabled={busy}
              onClick={() => void submit("denied")}
            >
              Deny
            </Button>
          </div>
        ) : (
          <div className="text-sm font-medium">
            {handoffLabel(invite.handoffStatus)}
          </div>
        )}
        {invite.status === "pending" ||
        invite.handoffStatus.startsWith("waiting_for_") ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {invite.status === "pending"
              ? "Approval deadline"
              : invite.status === "approved"
                ? "Pickup deadline"
                : invite.reconnecting
                  ? "Activation deadline"
                  : "Acknowledgment deadline"}
            :{" "}
            {new Date(
              invite.status === "pending"
                ? invite.approvalDeadlineAt
                : invite.status === "approved"
                  ? (invite.pickupDeadlineAt ?? invite.approvalDeadlineAt)
                  : (invite.activationDeadlineAt ??
                    invite.ackDeadlineAt ??
                    invite.approvalDeadlineAt),
            ).toLocaleString()}
          </p>
        ) : null}
        {invite.reason ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Cause: {handoffLabel(invite.reason)}
          </p>
        ) : null}
      </div>
    </AuthorizationShell>
  );
}
