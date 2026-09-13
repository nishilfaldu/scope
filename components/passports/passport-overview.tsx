"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
  Copy01Icon,
  Delete02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import { PassportPlatforms } from "@/components/passports/passport-platforms";
import { ContentCard } from "@/components/shared/content-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABELS } from "@/lib/audit";
import { formatRemaining } from "@/lib/capabilities";

export function PassportOverview({ passportId }: { passportId: string }) {
  const passport = useQuery(api.tables.passports.queries.get, { passportId });
  const revoke = useMutation(api.tables.passports.mutations.revoke);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [now] = useState(() => Date.now());

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function handleRevoke(token: string) {
    setRevoking(true);
    try {
      await revoke({ passportId: token });
    } finally {
      setRevoking(false);
    }
  }

  if (passport === undefined) {
    return <Skeleton className="h-28 w-full" />;
  }

  if (passport === null) {
    return null;
  }

  return (
    <ContentCard
      title={passport.name}
      description="Complete history of this passport's activity."
      action={
        passport.lifetimeStatus === "active" ? (
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
        ) : null
      }
    >
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
      <PassportPlatforms passportId={passportId} />
    </ContentCard>
  );
}
