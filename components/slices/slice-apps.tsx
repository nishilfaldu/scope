"use client";

import { useState } from "react";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

  const groups = visibleApps.map((app) => {
    const accounts = statuses?.find((status) => status.app === app)?.accounts ?? [];
    const appBindings = bindings?.filter((binding) => binding.app === app) ?? [];
    return {
      app,
      allowed: appBindings.map((binding) => ({
        connectionId: binding.connectionId,
        login: accounts.find((account) => account.id === binding.connectionId)?.login ?? null,
      })),
      available: accounts.filter((account) =>
        !appBindings.some((binding) => binding.connectionId === account.id)),
    };
  });
  const allowedGroups = groups.filter((group) => group.allowed.length > 0);
  const availableGroups = groups.filter((group) => group.available.length > 0);
  const allowedCount = allowedGroups.reduce((count, group) => count + group.allowed.length, 0);
  const availableCount = availableGroups.reduce((count, group) => count + group.available.length, 0);
  const active = effectiveSliceStatus(slice, now) === "active";

  return (
    <div className="border-t px-6 py-4">
      {statuses === undefined || bindings === undefined ? <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" />
      </div> : <>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Allowed accounts ({allowedCount})</h2>
          {active ? <Link href="/connections" className="text-sm text-primary hover:underline">Manage connections</Link> : null}
        </div>
        {allowedCount === 0 ? <p className="mt-3 text-sm text-muted-foreground">No accounts allowed on this slice.</p> : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {allowedGroups.map(({ app, allowed }) => <div key={app} className="space-y-2 rounded-xl border px-3 py-3">
              <p className="text-sm font-medium">{APP_LABELS[app]}</p>
              {allowed.map((account) => <div key={account.connectionId} className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-all text-xs">{account.login ?? "Disconnected account"}</span>
                {account.login !== null ? <Switch
                  checked
                  disabled={!active || isToggling}
                  onCheckedChange={() => handleToggle(app, account.connectionId, false)}
                  aria-label={`Remove ${APP_LABELS[app]} for ${account.login} from this slice`}
                /> : <Button
                  type="button" variant="ghost" size="xs" disabled={!active || isToggling}
                  onClick={() => handleToggle(app, account.connectionId, false)}
                >Remove</Button>}
              </div>)}
            </div>)}
          </div>
        )}
        {active && availableCount > 0 ? <Collapsible className="mt-5">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" size="sm">Add accounts ({availableCount})</Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-3 sm:grid-cols-2">
            {availableGroups.map(({ app, available }) => <div key={app} className="space-y-2 rounded-xl border px-3 py-3">
              <p className="text-sm font-medium">{APP_LABELS[app]}</p>
              {available.map((account) => <div key={account.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-all text-xs">{account.login}</span>
                <Switch
                  checked={false}
                  disabled={isToggling}
                  onCheckedChange={() => handleToggle(app, account.id, true)}
                  aria-label={`Allow ${APP_LABELS[app]} for ${account.login} on this slice`}
                />
              </div>)}
            </div>)}
          </CollapsibleContent>
        </Collapsible> : null}
      </>}
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
