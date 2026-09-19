"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { SignIn } from "@/components/auth/sign-in";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNow } from "@/hooks/use-now";

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

  if (isLoading) return <p className="p-8">Loading…</p>;
  if (!isAuthenticated) {
    return (
      <SignIn redirectTo={currentPath} title="Verify your email to connect" />
    );
  }
  if (invite === undefined) return <p className="p-8">Loading connection…</p>;
  if (invite === null) {
    return (
      <p className="mx-auto max-w-xl p-8">
        This connection link is unavailable.
      </p>
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
    <div className="mx-auto w-full max-w-xl p-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Connect agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p>
            <strong>{invite.agentName}</strong> wants to connect to your Agent
            Passport.
          </p>
          <p className="text-sm text-muted-foreground">
            The requester supplied this name. Agent Passport has not verified
            who operates it.
          </p>
          <p className="text-sm">
            Connecting lets this agent address future slice requests to your
            passport. You will still review each request, including its apps,
            accounts, duration, and reason.
          </p>
          <p className="text-sm text-muted-foreground">
            Verifying your email only proves which passport is present. The
            connection is created only when you approve below.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {pending ? (
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void submit("approved")}>
                Connect
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
            <p>This connection is {invite.status}.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
