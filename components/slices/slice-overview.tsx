"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SliceApps } from "@/components/slices/slice-apps";
import { SliceRevokeButton } from "@/components/slices/slice-revoke-button";
import { CopyableField } from "@/components/shared/copyable-field";
import { ExpiryTime } from "@/components/shared/expiry-time";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  effectiveSliceStatus,
  handoffLabel,
  STATUS_LABELS,
} from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";
import { useNow } from "@/hooks/use-now";

export function SliceOverview({ sliceId }: { sliceId: string }) {
  const now = useNow();
  const slice = useQuery(api.tables.slices.queries.get, { sliceId, now });
  const [setMintPolicy, isSettingPolicy] = useErrorCatchingMutation(
    api.tables.slices.mutations.setMintPolicy,
    { successMessage: "Approval policy updated" },
  );

  if (slice === undefined)
    return <Skeleton className="h-48 w-full rounded-xl" />;
  if (slice === null) return null;

  const status = effectiveSliceStatus(slice, now);
  const isActive = status === "active";

  return (
    <div className="flex flex-col gap-8">
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-col justify-between gap-5 px-5 py-5 sm:flex-row sm:items-start sm:px-6">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">
                {slice.name}
              </h1>
              <Badge
                variant={
                  status === "active"
                    ? "secondary"
                    : status === "revoked"
                      ? "destructive"
                      : "outline"
                }
              >
                {status === "staged"
                  ? handoffLabel(slice.handoffStatus ?? "waiting_for_pickup")
                  : STATUS_LABELS[status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {isActive
                ? "Access granted to a connected agent"
                : status === "staged"
                  ? handoffLabel(slice.handoffStatus ?? "waiting_for_pickup")
                  : status === "revoked"
                    ? "Access was revoked"
                    : "This grant has expired"}
            </p>
            {status === "staged" && slice.handoffDeadlineAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {slice.handoffStatus === "waiting_for_pickup"
                  ? "Pickup deadline"
                  : "Acknowledgment deadline"}
                : {new Date(slice.handoffDeadlineAt).toLocaleString()}
              </p>
            ) : null}
            {status === "revoked" && slice.revocationReason ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Cause: {handoffLabel(slice.revocationReason)}
              </p>
            ) : null}
          </div>
          {isActive || status === "staged" ? (
            <SliceRevokeButton
              sliceToken={slice.token}
              sliceName={slice.name}
            />
          ) : null}
        </div>
        <Separator />
        <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <p className="text-xs text-muted-foreground">Token approvals</p>
            <div className="mt-2 flex items-center gap-2.5">
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
              <label
                htmlFor={`mint-policy-${sliceId}`}
                className="text-sm font-medium"
              >
                {slice.mintPolicy === "approve" ? "Required" : "Automatic"}
              </label>
            </div>
          </div>
          <div className="p-5">
            <p className="text-xs text-muted-foreground">Expires</p>
            <div className="mt-1 text-sm font-medium">
              <ExpiryTime expiresAt={slice.expiresAt} now={now} stacked />
            </div>
          </div>
          <div className="p-5">
            <CopyableField
              label="Slice token"
              value={slice.token}
              successMessage="Slice token copied"
            />
          </div>
        </div>
      </section>
      <SliceApps sliceId={sliceId} />
    </div>
  );
}
