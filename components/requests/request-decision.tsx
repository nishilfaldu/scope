"use client";

import Link from "next/link";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_LABELS, APP_PERMISSIONS, type AppId } from "@/lib/capabilities";
import { useNow } from "@/hooks/use-now";

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
    api.tables.slices.accessRequests.getNewSlice,
    isAuthenticated && kind === "new" ? { publicToken } : "skip",
  );
  const tokenRequest = useQuery(
    api.tables.slices.accessRequests.getToken,
    isAuthenticated && kind === "token" ? { publicToken } : "skip",
  );
  const decide = useMutation(api.tables.slices.accessRequests.decide);
  const [selected, setSelected] = useState<
    Partial<Record<AppId, Id<"connections">[]>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = useNow();
  const request = kind === "new" ? newRequest : tokenRequest;
  const currentPath = `/requests/${kind}/${publicToken}`;

  if (isLoading) return <p className="p-8">Loading…</p>;
  if (!isAuthenticated)
    return (
      <SignIn redirectTo={currentPath} title="Verify your email to review" />
    );
  if (request === undefined) return <p className="p-8">Loading request…</p>;
  if (request === null)
    return (
      <p className="mx-auto max-w-xl p-8">
        This request is unavailable to this Agent Passport account.
      </p>
    );
  const pending = request.status === "pending" && request.expiresAt > now;

  async function submit(decision: "approved" | "denied") {
    if (!request) return;
    setBusy(true);
    setError("");
    try {
      await decide({
        publicToken,
        decision,
        bindings:
          kind === "new" && decision === "approved" && newRequest
            ? bindingsFor(newRequest.apps, selected)
            : undefined,
      });
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
    <div className="mx-auto w-full max-w-2xl p-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            {kind === "new" ? "New slice request" : "Token request"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {kind === "new" && newRequest ? (
            <>
              <p>
                <strong>{newRequest.agentName}</strong> requests a new slice for{" "}
                {duration(newRequest.ttlMs)}.
              </p>
              <p className="text-sm text-muted-foreground">
                The requester supplied this agent name and reason. Agent
                Passport has not verified the requester.
              </p>
              {newRequest.reason ? (
                <blockquote className="border-l-2 pl-4">
                  Reason: {newRequest.reason}
                </blockquote>
              ) : null}
              <div className="space-y-2">
                {newRequest.apps.map((app) => (
                  <div key={app} className="rounded-md border p-3">
                    <strong>{APP_LABELS[app]}</strong>
                    <p className="text-sm">{APP_PERMISSIONS[app]}</p>
                  </div>
                ))}
              </div>
              {pending ? (
                <>
                  <AccountBindings
                    apps={newRequest.apps}
                    selected={selected}
                    compact
                    allowConnect={false}
                    onChange={(app, ids) =>
                      setSelected((current) => ({ ...current, [app]: ids }))
                    }
                  />
                  <p className="text-sm">
                    Need another account? Add it in{" "}
                    <Link
                      className="underline"
                      href={`/connections?returnTo=${encodeURIComponent(currentPath)}`}
                    >
                      Connections
                    </Link>
                    , then return here.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Approval creates a slice for the selected accounts. The
                    agent can request provider tokens until the slice expires or
                    is revoked. Tokens already issued may remain valid until
                    their own expiry.
                  </p>
                </>
              ) : null}
            </>
          ) : null}
          {kind === "token" && tokenRequest ? (
            <>
              <p>
                <strong>{tokenRequest.sliceName}</strong> requests a short-lived{" "}
                {APP_LABELS[tokenRequest.app]} token.
              </p>
              <p>
                Connected account:{" "}
                <strong>
                  {tokenRequest.accountLogin ?? "No longer connected"}
                </strong>
              </p>
              <p className="text-sm">{APP_PERMISSIONS[tokenRequest.app]}</p>
              <p className="text-sm text-muted-foreground">
                Approval lets the agent claim a short-lived provider token for
                this specific account. The token may work until its expiry even
                if the slice is later revoked.
              </p>
            </>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Request expires {new Date(request.expiresAt).toLocaleString()}.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {pending ? (
            <div className="flex gap-2">
              <Button
                disabled={
                  busy ||
                  (kind === "token" && !tokenRequest?.accountLogin) ||
                  (kind === "new" &&
                    !!newRequest &&
                    newRequest.apps.some((app) => !selected[app]?.length))
                }
                onClick={() => void submit("approved")}
              >
                Approve
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void submit("denied")}
              >
                Deny
              </Button>
            </div>
          ) : (
            <p>This request is {request.status}.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
