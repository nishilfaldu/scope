"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { PassportApps } from "@/components/passports/passport-apps";
import { ContentCard } from "@/components/shared/content-card";
import { CopyableField } from "@/components/shared/copyable-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABELS } from "@/lib/audit";
import { formatRemaining } from "@/lib/capabilities";

export function PassportOverview({ passportId }: { passportId: string }) {
  const passport = useQuery(api.tables.passports.queries.get, { passportId });
  const revoke = useMutation(api.tables.passports.mutations.revoke);
  const [revoking, setRevoking] = useState(false);
  const [now] = useState(() => Date.now());

  async function handleRevoke(token: string) {
    setRevoking(true);
    try {
      await revoke({ passportId: token });
      toast.success("Passport revoked");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not revoke passport",
      );
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
        passport.status === "active" ? (
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
              passport.status === "active"
                ? "secondary"
                : passport.status === "revoked"
                  ? "destructive"
                  : "outline"
            }
          >
            {STATUS_LABELS[passport.status]}
          </Badge>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Expires</p>
          <p className="mt-1 text-sm">
            {formatRemaining(passport.expiresAt, now)}
          </p>
        </div>
        <CopyableField
          label="Passport id"
          value={passport._id}
          successMessage="Passport id copied"
        />
        <CopyableField
          label="Passport token"
          value={passport.token}
          successMessage="Passport token copied"
        />
      </div>
      <PassportApps passportId={passportId} />
    </ContentCard>
  );
}
