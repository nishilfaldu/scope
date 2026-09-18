"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { APP_LABELS, APP_PERMISSIONS, type AppId } from "@/lib/capabilities";
import { APP_CONNECT_URL } from "@/lib/connections";

const PAGE_SIZE = 50;
export type Binding = { app: AppId; connectionId: Id<"connections"> };
export type AccountSelection = Partial<Record<AppId, Id<"connections">>>;

export function bindingsFor(apps: readonly AppId[], selected: AccountSelection): Binding[] {
  return apps.flatMap((app) => selected[app] ? [{ app, connectionId: selected[app] }] : []);
}

export function AccountBindings({ apps, selected, onChange }: {
  apps: readonly AppId[];
  selected: AccountSelection;
  onChange: (app: AppId, id: Id<"connections">) => void;
}) {
  const [page, setPage] = useState(0);
  const [connecting, setConnecting] = useState<AppId | null>(null);
  const startOAuth = useMutation(api.tables.oauthStates.mutations.start);
  const lastPage = Math.max(0, Math.ceil(apps.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleApps = apps.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const statuses = useQuery(api.tables.connections.queries.statusesForApps, { apps: [...visibleApps] });

  useEffect(() => {
    for (const status of statuses ?? []) {
      if (status.accounts.length === 1 && !selected[status.app]) {
        onChange(status.app, status.accounts[0].id);
      }
    }
  }, [statuses, selected, onChange]);

  if (apps.length === 0) return null;
  const chosen = bindingsFor(apps, selected).length;
  async function connect(app: AppId) {
    setConnecting(app);
    try {
      const { state } = await startOAuth({ app, returnTo: window.location.href });
      const url = new URL(APP_CONNECT_URL[app]);
      url.searchParams.set("state", state);
      window.location.assign(url.toString());
    } finally {
      setConnecting(null);
    }
  }
  return <div className="space-y-3">
    <p className="text-sm font-medium">Accounts for this slice ({chosen} of {apps.length} selected)</p>
    {visibleApps.map((app) => {
      const accounts = statuses?.find((entry) => entry.app === app)?.accounts ?? [];
      return <div key={app} className="space-y-1 text-sm">
        <div><span className="font-medium">{APP_LABELS[app]}</span><p className="text-muted-foreground">{APP_PERMISSIONS[app]}</p></div>
        <select aria-label={`${APP_LABELS[app]} account`} className="w-full rounded-md border bg-background px-3 py-2" value={selected[app] ?? ""} onChange={(event) => onChange(app, event.target.value as Id<"connections">)} required>
          <option value="" disabled>{statuses === undefined ? "Loading accounts…" : accounts.length ? "Choose an account" : "Connect an account first"}</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.login}</option>)}
        </select>
        {statuses !== undefined && accounts.length === 0 ? <Button type="button" variant="outline" size="sm" disabled={connecting !== null} onClick={() => void connect(app)}>Connect {APP_LABELS[app]}</Button> : null}
        {statuses !== undefined && accounts.length > 0 ? <Button type="button" variant="ghost" size="sm" disabled={connecting !== null} onClick={() => void connect(app)}>Add another account</Button> : null}
      </div>;
    })}
    {apps.length > PAGE_SIZE ? <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous accounts</Button>
      <span className="text-sm">Page {currentPage + 1} of {lastPage + 1}</span>
      <Button type="button" variant="outline" size="sm" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next accounts</Button>
    </div> : null}
  </div>;
}
