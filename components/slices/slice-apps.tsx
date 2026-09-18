"use client";

import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ALL_APPS, APP_LABELS, effectiveSliceStatus, type AppId } from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";
import { useNow } from "@/hooks/use-now";

const PAGE_SIZE = 50;

export function SliceApps({ sliceId }: { sliceId: string }) {
  const now = useNow();
  const [page, setPage] = useState(0);
  const visibleApps = ALL_APPS.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const statuses = useQuery(api.tables.connections.queries.statusesForApps, { apps: visibleApps });
  const bindings = useQuery(api.tables.slices.queries.bindingsForApps, {
    sliceId: sliceId as Id<"slices">, apps: visibleApps,
  });
  const slice = useQuery(api.tables.slices.queries.get, { sliceId: sliceId });
  const [setBinding, isToggling] = useErrorCatchingMutation(
    api.tables.slices.mutations.setBinding,
    {
      successMessage: (args) =>
        args.enabled
          ? `${APP_LABELS[args.app]} enabled`
          : `${APP_LABELS[args.app]} disabled`,
    },
  );

  function handleToggle(app: AppId, connectionId: Id<"connections">, enabled: boolean) {
    if (!slice) return;
    void setBinding({
      connectionId,
      sliceToken: slice.token,
      app,
      enabled,
    });
  }

  if (slice === undefined) {
    return (
      <div className="border-t px-6 py-4">
        <Skeleton className="h-4 w-20" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (slice === null) {
    return null;
  }

  return (
    <div className="border-t px-6 py-4">
      <p className="text-xs text-muted-foreground">App permissions</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {visibleApps.map((app) => {
          const accounts = statuses?.find((status) => status.app === app)?.accounts ?? [];
          const bound = bindings?.filter((binding) => binding.app === app) ?? [];
          const disconnected = bound.filter((binding) => !accounts.some((account) => account.id === binding.connectionId));
          return (
            <div
              key={app}
              className="space-y-2 rounded-xl border px-3 py-3"
            >
              <p className="text-sm font-medium">{APP_LABELS[app]}</p>
              {accounts.length === 0 && disconnected.length === 0 ? <p className="text-xs text-muted-foreground">No connected accounts</p> : null}
              {accounts.map((account) => {
                const allowed = bound.some((binding) => binding.connectionId === account.id);
                return <div key={account.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 break-all text-xs">{account.login}</span>
                  <Switch
                    checked={allowed}
                    disabled={bindings === undefined || effectiveSliceStatus(slice, now) !== "active" || isToggling}
                    onCheckedChange={(checked) => handleToggle(app, account.id, checked)}
                    aria-label={`Allow ${APP_LABELS[app]} for ${account.login} on this slice`}
                  />
                </div>;
              })}
              {disconnected.map((binding) => <div key={binding._id} className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Disconnected account</span>
                <Switch checked disabled={effectiveSliceStatus(slice, now) !== "active" || isToggling} onCheckedChange={() => handleToggle(app, binding.connectionId, false)} aria-label={`Remove disconnected ${APP_LABELS[app]} account from this slice`} />
              </div>)}
            </div>
          );
        })}
      </div>
      {ALL_APPS.length > PAGE_SIZE ? (
        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm">Page {page + 1}</span>
          <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= ALL_APPS.length} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      ) : null}
    </div>
  );
}
