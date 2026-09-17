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
  const statuses = useQuery(api.tables.connections.queries.listStatuses);
  const [page, setPage] = useState(0);
  const visibleApps = ALL_APPS.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const bindings = useQuery(api.tables.slices.queries.bindingsForApps, {
    sliceId: sliceId as Id<"slices">, apps: visibleApps,
  });
  const [selected, setSelected] = useState<Partial<Record<AppId, Id<"connections">>>>({});
  const slice = useQuery(api.tables.slices.queries.get, { sliceId: sliceId });
  const [setApp, isToggling] = useErrorCatchingMutation(
    api.tables.slices.mutations.setApp,
    {
      successMessage: (args) =>
        args.enabled
          ? `${APP_LABELS[args.app]} enabled`
          : `${APP_LABELS[args.app]} disabled`,
    },
  );

  function handleToggle(app: AppId, enabled: boolean) {
    if (!slice) return;
    const accounts = statuses?.find((status) => status.app === app)?.accounts ?? [];
    const connectionId = selected[app] ?? (accounts.length === 1 ? accounts[0].id : undefined);
    if (enabled && !connectionId) return;
    void setApp({
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
          const allowed = bindings?.some((binding) => binding.app === app) ?? false;
          const connected = (statuses?.find((status) => status.app === app)?.connected ?? false);
          const accounts = statuses?.find((status) => status.app === app)?.accounts ?? [];
          const connectionId = selected[app] ?? (accounts.length === 1 ? accounts[0].id : undefined);
          const boundId = bindings?.find((binding) => binding.app === app)?.connectionId;
          const boundLogin = accounts.find((account) => account.id === boundId)?.login;
          return (
            <div
              key={app}
              className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2"
            >
              <div>
                <p className="text-sm">{APP_LABELS[app]}</p>
                <p className="text-xs text-muted-foreground">{allowed ? (boundLogin ? `Using ${boundLogin}` : "Selected account disconnected") : (connected ? "Account connected" : "Account not connected")}</p>
                {!allowed && accounts.length > 1 ? <select className="mt-1 max-w-48 rounded border bg-background px-2 py-1 text-xs" value={selected[app] ?? ""} onChange={(event) => setSelected((current) => ({ ...current, [app]: event.target.value as Id<"connections"> }))} aria-label={`Account for ${APP_LABELS[app]}`}><option value="" disabled>Choose an account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.login}</option>)}</select> : null}
              </div>
              <Switch
                checked={allowed}
                disabled={bindings === undefined || effectiveSliceStatus(slice, now) !== "active" || isToggling || !connected || (!allowed && !connectionId)}
                onCheckedChange={(checked) => handleToggle(app, checked)}
                aria-label={`Allow ${APP_LABELS[app]} on this slice`}
              />
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
