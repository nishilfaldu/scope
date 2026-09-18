"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { PassportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GoogleMark } from "@/components/auth/google-mark";
import { ExpiryTime } from "@/components/shared/expiry-time";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useNow } from "@/hooks/use-now";
import type { AppId } from "@/lib/capabilities";
import { APP_LABELS } from "@/lib/capabilities";

function appSummary(apps: readonly AppId[]) {
  const visible = apps.slice(0, 3).map((app) => APP_LABELS[app] ?? app);
  const remaining = apps.length - visible.length;
  return visible.join(", ") + (remaining > 0 ? ` and ${remaining} more` : "");
}

function ApprovalGate({ publicToken }: { publicToken: string }) {
  const { signIn } = useAuthActions();
  const summary = useQuery(
    api.tables.slices.accessRequestPublic.publicSummary,
    {
      publicToken,
    },
  );
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
      ? appSummary(summary.apps ?? []) || "apps"
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
                  : `${agentLabel} is requesting access to ${appsLabel}. The requester supplied this agent name. Sign in to review the accounts and permissions.`}
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
              Expires <ExpiryTime expiresAt={summary.expiresAt} now={now} />
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

export function ApprovalDetail({ publicToken }: { publicToken: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) router.replace(`/approvals?request=${encodeURIComponent(publicToken)}`);
  }, [isAuthenticated, publicToken, router]);

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

  return <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4"><Skeleton className="h-56 w-full max-w-sm" /></div>;
}
