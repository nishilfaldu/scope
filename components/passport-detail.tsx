"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import {
  Copy01Icon,
  Delete02Icon,
  PassportIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "../convex/_generated/api";
import { BoardShell } from "@/components/board-shell";
import { PassportHistory } from "@/components/passport-history";
import { PassportPlatforms } from "@/components/passport-platforms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABELS } from "@/lib/audit";
import { APP_LABELS, formatRemaining } from "@/lib/capabilities";

export function PassportDetail({ passportId }: { passportId: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const passport = useQuery(api.passports.get, { passportId, now });
  const chain = useQuery(api.audit.chainStatus, { passportId });
  const revoke = useMutation(api.passports.revoke);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function handleRevoke(token: string) {
    setRevoking(true);
    try {
      await revoke({ passportId: token });
      setNow(Date.now());
    } finally {
      setRevoking(false);
    }
  }

  if (passport === undefined) {
    return (
      <BoardShell title="Passport" crumbs={[{ label: "Passports", href: "/" }]}>
        <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="flex flex-col gap-3 px-4 lg:px-6">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </BoardShell>
    );
  }

  if (passport === null) {
    return (
      <BoardShell title="Not found" crumbs={[{ label: "Passports", href: "/" }]}>
        <div className="@container/main flex flex-1 flex-col py-4 md:py-6">
          <div className="px-4 lg:px-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={PassportIcon} strokeWidth={2} />
                </EmptyMedia>
                <EmptyTitle>Passport not found</EmptyTitle>
                <EmptyDescription>
                  This card may have been deleted from the deployment, or the
                  link is invalid.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        </div>
      </BoardShell>
    );
  }

  return (
    <BoardShell
      title={passport.name}
      crumbs={[{ label: "Passports", href: "/" }]}
    >
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>{passport.name}</CardTitle>
              <CardDescription>
                Complete history of everything that touched this passport.
                Events cannot be edited or deleted.
              </CardDescription>
              <CardAction className="flex flex-wrap items-center gap-2">
                {passport.lifetimeStatus === "active" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoking}
                    onClick={() => void handleRevoke(passport.token)}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      strokeWidth={2}
                      data-icon="inline-start"
                    />
                    {revoking ? "Revoking…" : "Revoke"}
                  </Button>
                ) : null}
              </CardAction>
            </CardHeader>
            <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge
                  className="mt-1"
                  variant={
                    passport.lifetimeStatus === "active"
                      ? "secondary"
                      : passport.lifetimeStatus === "revoked"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {STATUS_LABELS[passport.lifetimeStatus]}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Apps</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {passport.apps.map((app) => (
                    <Badge key={app} variant="secondary">
                      {APP_LABELS[app]}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expires</p>
                <p className="mt-1 text-sm">
                  {formatRemaining(passport.expiresAt, now)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Passport id</p>
                <div className="mt-1 flex min-w-0 items-center gap-1">
                  <code className="max-w-36 truncate font-mono text-xs">
                    {passport.token}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void copyToken(passport.token)}
                  >
                    <HugeiconsIcon
                      icon={copied ? Tick02Icon : Copy01Icon}
                      strokeWidth={2}
                    />
                    <span className="sr-only">Copy token</span>
                  </Button>
                </div>
              </div>
            </div>
            {chain ? (
              <div className="border-t px-6 py-3 text-sm">
                {chain.eventCount === 0 ? (
                  <p className="text-muted-foreground">
                    No chained events yet.
                  </p>
                ) : chain.intact ? (
                  <p>
                    Audit chain intact · {chain.eventCount} event
                    {chain.eventCount === 1 ? "" : "s"}. Records are append-only.
                  </p>
                ) : (
                  <p className="text-destructive">
                    Audit chain broken · expected seq {chain.expectedSeq}, found{" "}
                    {chain.eventCount}.
                  </p>
                )}
              </div>
            ) : null}
            <PassportPlatforms
              queryId={passportId}
              token={passport.token}
              apps={passport.apps}
              lifetimeStatus={passport.lifetimeStatus}
              now={now}
              onChanged={() => setNow(Date.now())}
            />
          </Card>
        </div>

        <PassportHistory passportId={passportId} />
      </div>
    </BoardShell>
  );
}
