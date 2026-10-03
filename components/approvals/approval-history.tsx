"use client";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ApprovalAccount } from "@/lib/approval-display";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export function ApprovalHistory({ accounts }: { accounts: ApprovalAccount[] }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.probe.credentialsForOwner,
    {},
    { initialNumItems: 20 },
  );
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        Review which recipients received access. Repeated deliveries of the same
        credential are grouped together.
      </p>
      {status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : !results.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            title="No deliveries yet"
            description="Confirmed deliveries and their recipients will appear here."
          />
        </div>
      ) : (
        results.map((credential) => {
          const account = accounts.find((a) => a._id === credential.accountId);
          return (
            <details
              key={credential.id}
              className="group overflow-hidden rounded-xl border bg-card"
            >
              <summary className="cursor-pointer p-5 text-sm focus-visible:outline-2 focus-visible:outline-ring">
                <span className="font-semibold">
                  {account?.label ?? "Unavailable account"}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {account?.credentialKind === "shared-pat"
                    ? "Shared personal access token"
                    : "Account credential"}{" "}
                  · View recipients
                </span>
              </summary>
              <div className="border-t p-5">
                <p className="mb-4 text-xs leading-5 text-muted-foreground">
                  First{" "}
                  {account?.credentialKind === "shared-pat"
                    ? "Connect response"
                    : "observed"}{" "}
                  expiry: {new Date(credential.expiresAt).toLocaleString()}.
                  {account?.credentialKind === "shared-pat" &&
                    " This does not establish when the Airtable token expires."}
                </p>
                <DeliveryHistory id={credential.id} />
              </div>
            </details>
          );
        })
      )}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <Button
          variant="outline"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(20)}
        >
          {status === "LoadingMore" ? "Loading…" : "Load older deliveries"}
        </Button>
      )}
    </div>
  );
}
function DeliveryHistory({ id }: { id: Id<"probeCredentials"> }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.probe.credentialDeliveries,
    { id },
    { initialNumItems: 10 },
  );
  return (
    <div className="space-y-4">
      {status === "LoadingFirstPage" && <Skeleton className="h-20 w-full" />}
      {results.map((r) => (
        <article
          key={r.id}
          className="space-y-2 border-t pt-4 text-sm first:border-0 first:pt-0"
        >
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {r.status === "cancelled" ? "Delivery stopped" : r.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {r.deliveryAttempts} delivery attempts
            </span>
          </div>
          <p className="break-words">{r.reason}</p>
          <p className="text-xs text-muted-foreground">
            {r.receivedAt
              ? `Receipt confirmed ${new Date(r.receivedAt).toLocaleString()}`
              : r.deliveredAt
                ? "Delivery attempted; receipt unconfirmed"
                : "No confirmed delivery"}
          </p>
          <p className="text-xs text-muted-foreground">
            Delivery deadline: {new Date(r.expiresAt).toLocaleString()}
          </p>
          <details>
            <summary className="w-fit cursor-pointer text-xs text-muted-foreground">
              Exact recipient
            </summary>
            <p className="mt-2 break-all text-xs leading-5">{r.requester}</p>
          </details>
        </article>
      ))}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <Button
          variant="outline"
          size="sm"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(10)}
        >
          Load more recipients
        </Button>
      )}
    </div>
  );
}
