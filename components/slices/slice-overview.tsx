"use client";

import { useNow } from "@/hooks/use-now";

import { useQuery } from "convex/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import { SliceApps } from "@/components/slices/slice-apps";
import { SliceRequests } from "@/components/approvals/slice-requests";
import { ContentCard } from "@/components/shared/content-card";
import { CopyableField } from "@/components/shared/copyable-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  effectiveSliceStatus,
  formatRemaining,
  STATUS_LABELS,
} from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

export function SliceOverview({ sliceId }: { sliceId: string }) {
  const slice = useQuery(api.tables.slices.queries.get, { sliceId: sliceId });
  const [revoke, isRevoking] = useErrorCatchingMutation(
    api.tables.slices.mutations.revoke,
    { successMessage: "Slice revoked" },
  );
  const [setMintPolicy, isSettingPolicy] = useErrorCatchingMutation(
    api.tables.slices.mutations.setMintPolicy,
    { successMessage: "Mint policy updated" },
  );
  const now = useNow();

  if (slice === undefined) {
    return <Skeleton className="h-28 w-full" />;
  }

  if (slice === null) {
    return null;
  }

  const isActive = effectiveSliceStatus(slice, now) === "active";

  return (
    <div className="flex flex-col gap-4">
      <ContentCard
        title={slice.name}
        description="Status, credentials, mint policy, and apps from this slice."
        action={
          isActive ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isRevoking}
              onClick={() => void revoke({ sliceToken: slice.token })}
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
        <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge
              className="mt-1"
              variant={
                effectiveSliceStatus(slice, now) === "active"
                  ? "secondary"
                  : effectiveSliceStatus(slice, now) === "revoked"
                    ? "destructive"
                    : "outline"
              }
            >
              {STATUS_LABELS[effectiveSliceStatus(slice, now)]}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Mint policy</p>
            <div className="mt-1 flex items-center gap-2">
              <Switch
                id={`mint-policy-${sliceId}`}
                checked={slice.mintPolicy === "approve"}
                disabled={!isActive || isSettingPolicy}
                onCheckedChange={(checked) =>
                  void setMintPolicy({
                    sliceToken: slice.token,
                    mintPolicy: checked ? "approve" : "auto",
                  })
                }
              />
              <label htmlFor={`mint-policy-${sliceId}`} className="text-sm">
                Require approval
              </label>
            </div>
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
      <SliceRequests sliceId={sliceId} />
    </div>
  );
}
