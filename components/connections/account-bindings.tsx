"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { APP_LABELS, APP_PERMISSIONS, type AppId } from "@/lib/capabilities";
import { APP_CONNECT_URL } from "@/lib/connections";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { AppIcon } from "@/components/shared/app-icon";
import { usePathname } from "next/navigation";

const PAGE_SIZE = 50;
export type Binding = { app: AppId; connectionId: Id<"connections"> };
export type AccountSelection = Partial<Record<AppId, Id<"connections">[]>>;

export function bindingsFor(
  apps: readonly AppId[],
  selected: AccountSelection,
): Binding[] {
  return apps.flatMap((app) =>
    (selected[app] ?? []).map((connectionId) => ({ app, connectionId })),
  );
}

export function AccountBindings({
  apps,
  selected,
  onChange,
  compact = false,
  allowConnect = true,
}: {
  apps: readonly AppId[];
  selected: AccountSelection;
  onChange: (app: AppId, ids: Id<"connections">[]) => void;
  compact?: boolean;
  allowConnect?: boolean;
}) {
  const [page, setPage] = useState(0);
  const [connecting, setConnecting] = useState<AppId | null>(null);
  const pathname = usePathname();
  const startOAuth = useMutation(api.tables.oauthStates.mutations.start);
  const lastPage = Math.max(0, Math.ceil(apps.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleApps = apps.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const statuses = useQuery(api.tables.connections.queries.statusesForApps, {
    apps: [...visibleApps],
  });

  useEffect(() => {
    for (const status of statuses ?? []) {
      if (status.accounts.length === 1 && selected[status.app] === undefined) {
        onChange(status.app, [status.accounts[0].id]);
      }
    }
  }, [statuses, selected, onChange]);

  if (apps.length === 0) return null;
  const chosen = bindingsFor(apps, selected).length;
  async function connect(app: AppId) {
    setConnecting(app);
    try {
      const { state } = await startOAuth({
        app,
        returnTo: window.location.href,
      });
      const url = new URL(APP_CONNECT_URL[app]);
      url.searchParams.set("state", state);
      window.location.assign(url.toString());
    } finally {
      setConnecting(null);
    }
  }
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Choose accounts</h2>
        <span className="text-xs text-muted-foreground">{chosen} selected</span>
      </div>
      <div className="divide-y rounded-xl border bg-background">
        {visibleApps.map((app) => {
          const accounts =
            statuses?.find((entry) => entry.app === app)?.accounts ?? [];
          return (
            <div key={app} className="flex gap-3 px-3.5 py-3 text-sm">
              <AppIcon app={app} />
              <div className="min-w-0 flex-1">
                <span className="font-medium">{APP_LABELS[app]}</span>
                {!compact ? (
                  <p className="text-muted-foreground">
                    {APP_PERMISSIONS[app]}
                  </p>
                ) : null}
                <div className="mt-2 space-y-2">
                  {statuses === undefined ? (
                    <>
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-5 w-32" />
                    </>
                  ) : accounts.length === 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/70 px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        No connected account
                      </span>
                      {!allowConnect ? (
                        <Link
                          className="text-xs font-medium underline underline-offset-4"
                          href={`/connections?returnTo=${encodeURIComponent(pathname)}`}
                        >
                          Open Connections
                        </Link>
                      ) : null}
                    </div>
                  ) : (
                    accounts.map((account) => {
                      const checked =
                        selected[app]?.includes(account.id) ?? false;
                      const id = `account-${app}-${account.id}`;
                      return (
                        <div
                          key={account.id}
                          className="flex min-w-0 items-center gap-2.5"
                        >
                          <Checkbox
                            id={id}
                            checked={checked}
                            onCheckedChange={(next) =>
                              onChange(
                                app,
                                next
                                  ? [...(selected[app] ?? []), account.id]
                                  : (selected[app] ?? []).filter(
                                      (value) => value !== account.id,
                                    ),
                              )
                            }
                          />
                          <label
                            htmlFor={id}
                            className="min-w-0 break-all text-sm"
                          >
                            {account.login}
                          </label>
                        </div>
                      );
                    })
                  )}
                </div>
                {allowConnect &&
                !compact &&
                statuses !== undefined &&
                accounts.length === 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={connecting !== null}
                    onClick={() => void connect(app)}
                  >
                    Connect {APP_LABELS[app]}
                  </Button>
                ) : null}
                {allowConnect &&
                !compact &&
                statuses !== undefined &&
                accounts.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={connecting !== null}
                    onClick={() => void connect(app)}
                  >
                    Add another account
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {apps.length > PAGE_SIZE ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous accounts
          </Button>
          <span className="text-sm">
            Page {currentPage + 1} of {lastPage + 1}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage === lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            Next accounts
          </Button>
        </div>
      ) : null}
    </div>
  );
}
