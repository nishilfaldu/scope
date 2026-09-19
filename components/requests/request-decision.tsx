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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { APP_LABELS, APP_PERMISSIONS, type AppId } from "@/lib/capabilities";
import { useNow } from "@/hooks/use-now";
import { AuthorizationShell } from "@/components/shared/authorization-shell";
import { AppIcon } from "@/components/shared/app-icon";
import { Clock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

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
  const newRequest = useQuery(
    api.tables.slices.sliceRequests.get,
    isAuthenticated && kind === "new" ? { publicToken } : "skip",
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
  const [error, setError] = useState("");
  const now = useNow();
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
  const pending = request.status === "pending" && request.expiresAt > now;

  async function submit(decision: "approved" | "denied") {
    if (!request) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "new" && newRequest) {
        await decideSlice({
          publicToken,
          decision,
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
      <div className="px-6 pt-7 sm:px-8 sm:pt-8">
        {kind === "new" && newRequest ? (
          <>
            <Badge variant="secondary" className="mb-3">
              Connected agent
            </Badge>
            <h1 className="text-balance text-2xl font-semibold tracking-tight">
              {newRequest.agentName} requests access
            </h1>
            <div className="mt-6 rounded-xl bg-muted/70 px-4 py-3.5">
              <p className="text-xs font-medium text-muted-foreground">
                Purpose
              </p>
              <p className="mt-1 text-sm leading-6">{newRequest.reason}</p>
            </div>
            <div className="mt-6">
              <h2 className="text-sm font-semibold">Requested access</h2>
              <div className="mt-2 divide-y rounded-xl border bg-background">
                {newRequest.apps.map((app) => (
                  <div key={app} className="flex gap-3 px-3.5 py-3">
                    <AppIcon app={app} />
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
            {pending ? (
              <div className="mt-6">
                <AccountBindings
                  apps={newRequest.apps}
                  selected={selected}
                  compact
                  allowConnect={false}
                  onChange={(app, ids) =>
                    setSelected((current) => ({ ...current, [app]: ids }))
                  }
                />
              </div>
            ) : null}
            <div className="mt-6 flex items-center gap-3 rounded-xl border px-3.5 py-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon
                  icon={Clock01Icon}
                  className="size-4"
                  strokeWidth={2}
                />
              </span>
              <div>
                <p className="text-sm font-medium">
                  Valid for {duration(newRequest.ttlMs)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Expires automatically
                </p>
              </div>
            </div>
          </>
        ) : null}
        {kind === "token" && tokenRequest ? (
          <>
            <Badge variant="secondary" className="mb-3">
              One-time approval
            </Badge>
            <h1 className="text-balance text-2xl font-semibold tracking-tight">
              Allow {APP_LABELS[tokenRequest.app]} access?
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Requested by {tokenRequest.sliceName}
            </p>
            <div className="mt-6 rounded-xl border bg-background">
              <div className="flex gap-3 px-4 py-4">
                <AppIcon app={tokenRequest.app} className="size-10" />
                <div>
                  <p className="font-medium">
                    {tokenRequest.accountLogin ?? "Account disconnected"}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    {APP_PERMISSIONS[tokenRequest.app]}
                  </p>
                </div>
              </div>
              <Separator />
              <p className="px-4 py-3 text-xs text-muted-foreground">
                Approval applies to this token request only.
              </p>
            </div>
          </>
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mt-5">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <div className="mt-7 border-t bg-muted/25 px-6 py-5 sm:px-8">
        {pending ? (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              className="h-11 sm:min-w-40"
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
                  ? `Allow for ${duration(newRequest.ttlMs)}`
                  : "Approve once"}
            </Button>
            <Button
              variant="ghost"
              className="h-11 sm:min-w-24"
              disabled={busy}
              onClick={() => void submit("denied")}
            >
              Decline
            </Button>
          </div>
        ) : (
          <p className="text-sm">
            This request is{" "}
            <span className="font-medium">{request.status}</span>.
          </p>
        )}
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Link expires {new Date(request.expiresAt).toLocaleString()}.
        </p>
      </div>
    </AuthorizationShell>
  );
}
