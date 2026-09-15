"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import { SliceApps } from "@/components/slices/slice-apps";
import { ContentCard } from "@/components/shared/content-card";
import { CopyableField } from "@/components/shared/copyable-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRemaining, STATUS_LABELS } from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

export function SliceOverview({ sliceId }: { sliceId: string }) {
  const slice = useQuery(api.tables.slices.queries.get, { sliceId: sliceId });
  const [revoke, isRevoking] = useErrorCatchingMutation(
    api.tables.slices.mutations.revoke,
    { successMessage: "Slice revoked" },
  );
  const [now] = useState(() => Date.now());

  if (slice === undefined) {
    return <Skeleton className="h-28 w-full" />;
  }

  if (slice === null) {
    return null;
  }

  return (
    <ContentCard
      title={slice.name}
      description="Status, credentials, and apps for this slice."
      action={
        slice.status === "active" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isRevoking}
            onClick={() => void revoke({ passportToken: slice.token })}
          >
            <HugeiconsIcon
              icon={Delete02Icon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            {isRevoking ? "Revoking…" : "Revoke"}
          </Button>
        ) : null
      }
    >
      <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <Badge
            className="mt-1"
            variant={
              slice.status === "active"
                ? "secondary"
                : slice.status === "revoked"
                  ? "destructive"
                  : "outline"
            }
          >
            {STATUS_LABELS[slice.status]}
          </Badge>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Expires</p>
          <p className="mt-1 text-sm">
            {formatRemaining(slice.expiresAt, now)}
          </p>
        </div>
        <CopyableField
          label="Slice token"
          value={slice.token}
          successMessage="Slice token copied"
        />
      </div>
      <SliceApps sliceId={sliceId} />
    </ContentCard>
  );
}
