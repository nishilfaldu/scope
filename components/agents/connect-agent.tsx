"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { SignIn } from "@/components/auth/sign-in";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthorizationShell } from "@/components/shared/authorization-shell";
import { useNow } from "@/hooks/use-now";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ConnectAgent({ publicToken }: { publicToken: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const invite = useQuery(
    api.tables.agentConnections.getInvite,
    isAuthenticated ? { publicToken } : "skip",
  );
  const decide = useMutation(api.tables.agentConnections.decideInvite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = useNow();
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

  const pending = invite.status === "pending" && invite.expiresAt > now;

  async function submit(decision: "approved" | "denied") {
    setBusy(true);
    setError("");
    try {
      await decide({ publicToken, decision });
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
      <div className="px-6 pb-6 pt-7 sm:px-8 sm:pb-8">
        <div className="flex items-start gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-foreground text-lg font-semibold text-background shadow-sm">
            {invite.agentName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <Badge variant="secondary" className="mb-2">
              {invite.reconnecting ? "Reconnect" : "New agent"}
            </Badge>
            <h1 className="text-balance text-2xl font-semibold tracking-tight">
              {invite.reconnecting ? "Reconnect" : "Connect"} {invite.agentName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Name provided by the requester
            </p>
          </div>
        </div>
        <Separator className="my-6" />
        <div className="rounded-xl bg-muted/70 px-4 py-3.5 text-sm leading-6">
          {invite.reconnecting ? (
            <p>
              This replaces the previous connection. Its existing access stays
              revoked.
            </p>
          ) : (
            <p>
              This agent can send access requests to your Scope account. You
              decide what to allow each time.
            </p>
          )}
        </div>
        {error ? (
          <Alert variant="destructive" className="mt-5">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {pending ? (
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              className="h-11 sm:min-w-36"
              disabled={busy}
              onClick={() => void submit("approved")}
            >
              {busy
                ? "Working…"
                : invite.reconnecting
                  ? "Reconnect agent"
                  : "Connect agent"}
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
          <div className="mt-6 rounded-xl border px-4 py-3 text-sm">
            This connection is{" "}
            <span className="font-medium">{invite.status}</span>.
          </div>
        )}
      </div>
    </AuthorizationShell>
  );
}
