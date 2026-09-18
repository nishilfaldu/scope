"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { APP_LABELS, APP_PERMISSIONS, type AppId } from "@/lib/capabilities";
import { APP_CONNECT_URL } from "@/lib/connections";

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
    <div className="space-y-3">
      <p className="text-sm font-medium">Accounts ({chosen} selected)</p>
      {visibleApps.map((app) => {
        const accounts =
          statuses?.find((entry) => entry.app === app)?.accounts ?? [];
        return (
          <div
            key={app}
            className={
              compact
                ? "grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:items-center"
                : "space-y-1 text-sm"
            }
          >
            <div>
              <span className="font-medium">{APP_LABELS[app]}</span>
              {!compact ? (
                <p className="text-muted-foreground">{APP_PERMISSIONS[app]}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              {statuses === undefined ? (
                <p className="text-muted-foreground">Loading accounts…</p>
              ) : accounts.length === 0 ? (
                <p className="text-muted-foreground">
                  Connect an account first
                </p>
              ) : (
                accounts.map((account) => {
                  const checked = selected[app]?.includes(account.id) ?? false;
                  const id = `account-${app}-${account.id}`;
                  return (
                    <div
                      key={account.id}
                      className="flex min-w-0 items-center gap-2"
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
                      <label htmlFor={id} className="min-w-0 break-all">
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
        );
      })}
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
