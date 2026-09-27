"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { SignIn } from "@/components/auth/sign-in";
import {
  AccountBindings,
  bindingsFor,
} from "@/components/connections/account-bindings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  APP_LABELS,
  APP_PERMISSIONS,
  handoffLabel,
  type AppId,
} from "@/lib/capabilities";
import { useNow } from "@/hooks/use-now";
import { AuthorizationShell } from "@/components/shared/authorization-shell";
import { AppIcon } from "@/components/shared/app-icon";
import {
  DecisionFact,
  DecisionFacts,
  DecisionHeader,
} from "@/components/shared/decision-card";

function duration(ms: number) {
  const hours = ms / 3_600_000;
  return hours >= 24
    ? `${hours / 24} days`
    : hours >= 1
      ? `${hours} hours`
      : `${ms / 60_000} minutes`;
}

export function RequestDecision({
  kind,
  publicToken,
}: {
  kind: "new" | "token";
  publicToken: string;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const now = useNow();
  const newRequest = useQuery(
    api.tables.slices.sliceRequests.get,
    isAuthenticated && kind === "new" ? { publicToken, now } : "skip",
  );
  const tokenRequest = useQuery(
    api.tables.slices.tokenRequests.get,
    isAuthenticated && kind === "token" ? { publicToken } : "skip",
  );
  const decideSlice = useMutation(api.tables.slices.sliceRequests.decide);
  const decideToken = useMutation(api.tables.slices.tokenRequests.decide);
  const [selected, setSelected] = useState<
    Partial<Record<AppId, Id<"connections">[]>>
  >({});
  const [busy, setBusy] = useState(false);
  const [mintPolicy, setMintPolicy] = useState<"auto" | "approve">("auto");
  const [error, setError] = useState("");
  const request = kind === "new" ? newRequest : tokenRequest;
  const currentPath = `/requests/${kind}/${publicToken}`;

  if (isLoading)
    return (
      <AuthorizationShell>
        <div className="space-y-5 p-8">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </AuthorizationShell>
    );
  if (!isAuthenticated)
    return (
      <SignIn redirectTo={currentPath} title="Verify your email to review" />
    );
  if (request === undefined)
    return (
      <AuthorizationShell>
        <div className="space-y-5 p-8">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </AuthorizationShell>
    );
  if (request === null)
    return (
      <AuthorizationShell>
        <div className="px-8 py-12 text-center">
          <h1 className="text-xl font-semibold">Request unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link is invalid, expired, or belongs to another Scope account.
          </p>
        </div>
      </AuthorizationShell>
    );
  const deadlineAt =
    kind === "new" ? newRequest?.approvalDeadlineAt : tokenRequest?.expiresAt;
  const pending =
    kind === "new"
      ? newRequest?.handoffStatus === "waiting_for_approval"
      : request.status === "pending" && (deadlineAt ?? 0) > now;

  async function submit(decision: "approved" | "denied") {
    if (!request) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "new" && newRequest) {
        await decideSlice({
          publicToken,
          decision,
          mintPolicy: decision === "approved" ? mintPolicy : undefined,
          bindings:
            decision === "approved"
              ? bindingsFor(newRequest.apps, selected)
              : undefined,
        });
      } else {
        await decideToken({ publicToken, decision });
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not decide this request.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthorizationShell>
      {kind === "new" && newRequest ? (
        <DecisionHeader
          title={newRequest.agentName}
          subtitle={`requests access for ${duration(newRequest.ttlMs)}`}
          leading={
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-xs font-semibold text-background">
              {newRequest.agentName.slice(0, 2).toUpperCase()}
            </span>
          }
        />
      ) : null}
      {kind === "token" && tokenRequest ? (
        <DecisionHeader
          title={tokenRequest.sliceName}
          subtitle="requests one-time access"
          leading={<AppIcon app={tokenRequest.app} />}
        />
      ) : null}
      <div className="px-6 py-6 sm:px-8">
        {kind === "new" && newRequest ? (
          <div className="space-y-6">
            <DecisionFacts>
              <DecisionFact label="Reason">{newRequest.reason}</DecisionFact>
              <DecisionFact label="Duration">
                {duration(newRequest.ttlMs)} · expires automatically
              </DecisionFact>
            </DecisionFacts>
            {pending ? (
              <>
                <div className="rounded-xl border p-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="mintPolicy"
                      checked={mintPolicy === "auto"}
                      onChange={() => setMintPolicy("auto")}
                    />{" "}
                    Allow automatic credential minting
                  </label>
                  <label className="mt-2 flex items-center gap-2">
                    <input
                      type="radio"
                      name="mintPolicy"
                      checked={mintPolicy === "approve"}
                      onChange={() => setMintPolicy("approve")}
                    />{" "}
                    Approve each credential request
                  </label>
                </div>
                <AccountBindings
                  apps={newRequest.apps}
                  selected={selected}
                  allowConnect={false}
                  onChange={(app, ids) =>
                    setSelected((current) => ({ ...current, [app]: ids }))
                  }
                />
              </>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground">
                  Requested access
                </p>
                <div className="mt-3 divide-y rounded-xl bg-muted/55">
                  {newRequest.apps.map((app) => (
                    <div key={app} className="flex gap-3 px-4 py-3.5">
                      <AppIcon app={app} className="bg-background" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{APP_LABELS[app]}</p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {APP_PERMISSIONS[app]}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
        {kind === "token" && tokenRequest ? (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-muted-foreground">Requested account</p>
              <div className="mt-3 flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-4">
                <AppIcon app={tokenRequest.app} className="bg-background" />
                <div className="min-w-0">
                  <p className="font-medium">{APP_LABELS[tokenRequest.app]}</p>
                  <p className="mt-0.5 break-all text-sm text-muted-foreground">
                    {tokenRequest.accountLogin ?? "Account disconnected"}
                  </p>
                </div>
              </div>
            </div>
            <DecisionFacts>
              <DecisionFact label="Can do">
                {APP_PERMISSIONS[tokenRequest.app]}
              </DecisionFact>
              <DecisionFact label="Effect">
                Issues one credential for this request only
              </DecisionFact>
            </DecisionFacts>
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
              disabled={
                busy ||
                (kind === "token" && !tokenRequest?.accountLogin) ||
                (kind === "new" &&
                  !!newRequest &&
                  newRequest.apps.some((app) => !selected[app]?.length))
              }
              onClick={() => void submit("approved")}
            >
              {busy
                ? "Working…"
                : kind === "new" && newRequest
                  ? `Approve for ${duration(newRequest.ttlMs)}`
                  : "Approve"}
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
          <p className="text-sm font-medium">
            {kind === "new" && newRequest
              ? handoffLabel(newRequest.handoffStatus)
              : `This request is ${request.status}.`}
          </p>
        )}
        {!pending && request.status === "approved" ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Return to your agent chat. If the agent paused, reply
            &ldquo;Continue&rdquo; so it can finish this request.
          </p>
        ) : null}
        {request.status === "pending" ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Approval deadline: {new Date(deadlineAt ?? 0).toLocaleString()}
          </p>
        ) : null}
        {kind === "new" && newRequest ? (
          <div className="mt-3 text-xs text-muted-foreground">
            {newRequest.handoffStatus === "waiting_for_pickup" &&
            newRequest.pickupDeadlineAt ? (
              <p>
                Agent pickup deadline:{" "}
                {new Date(newRequest.pickupDeadlineAt).toLocaleString()}
              </p>
            ) : null}
            {newRequest.handoffStatus === "waiting_for_ack" &&
            newRequest.ackDeadlineAt ? (
              <p>
                Agent acknowledgment deadline:{" "}
                {new Date(newRequest.ackDeadlineAt).toLocaleString()}
              </p>
            ) : null}
            {newRequest.sliceExpiresAt ? (
              <p>
                Grant expires:{" "}
                {new Date(newRequest.sliceExpiresAt).toLocaleString()}
              </p>
            ) : null}
            {newRequest.reasonCode ? (
              <p>Cause: {handoffLabel(newRequest.reasonCode)}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </AuthorizationShell>
  );
}
