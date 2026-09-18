"use client";

import { useNow } from "@/hooks/use-now";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SliceApps } from "@/components/slices/slice-apps";
import { SliceRevokeButton } from "@/components/slices/slice-revoke-button";
import { SliceRequests } from "@/components/approvals/slice-requests";
import { ContentCard } from "@/components/shared/content-card";
import { CopyableField } from "@/components/shared/copyable-field";
import { ExpiryTime } from "@/components/shared/expiry-time";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  effectiveSliceStatus,
  STATUS_LABELS,
} from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

export function SliceOverview({ sliceId }: { sliceId: string }) {
  const slice = useQuery(api.tables.slices.queries.get, { sliceId: sliceId });
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
        action={
          isActive ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id={`mint-policy-${sliceId}`}
                  checked={slice.mintPolicy === "approve"}
                  disabled={isSettingPolicy}
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
              <SliceRevokeButton sliceToken={slice.token} sliceName={slice.name} />
            </div>
          ) : null
        }
      >
        <div className="grid gap-4 p-6 sm:grid-cols-3">
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
            <p className="mt-1 text-sm">{slice.mintPolicy === "approve" ? "Approval required" : "Automatic"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expires</p>
            <div className="mt-1 text-sm"><ExpiryTime expiresAt={slice.expiresAt} now={now} stacked /></div>
          </div>
        </div>
        <div className="px-6 pb-4">
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
