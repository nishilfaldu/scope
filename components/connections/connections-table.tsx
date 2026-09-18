"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { DatabaseIcon, GithubIcon, GoogleIcon, SlackIcon, Notion01Icon, Chart01Icon, CloudIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CONNECTION_APPS, APP_CONNECT_URL, type AppId } from "@/lib/connections";

const PAGE_SIZE = 10;

function appIcon(app: AppId) {
  if (["gmail", "calendar", "drive", "docs", "sheets"].includes(app)) return GoogleIcon;
  switch (app) {
    case "github": return GithubIcon;
    case "slack": return SlackIcon;
    case "airtable": case "zoom": return DatabaseIcon;
    case "notion": return Notion01Icon;
    case "linear": return Chart01Icon;
    case "vercel": return CloudIcon;
    default: return GoogleIcon;
  }
}

type Row = (typeof CONNECTION_APPS)[number] & { accounts: { id: Id<"connections">; login: string; providerUserId: string }[] | undefined };

export function ConnectionsTable() {
  const [page, setPage] = useState(0);
  const visibleApps = CONNECTION_APPS.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const statuses = useQuery(api.tables.connections.queries.statusesForApps, { apps: visibleApps.map((app) => app.id) });
  const disconnect = useAction(api.tables.connections.actions.disconnect);
  const startOAuth = useMutation(api.tables.oauthStates.mutations.start);
  const [busy, setBusy] = useState<string | null>(null);

  async function connect(app: AppId) {
    setBusy(app);
    try {
      const { state } = await startOAuth({ app, returnTo: `${window.location.origin}/connections` });
      const url = new URL(APP_CONNECT_URL[app]);
      url.searchParams.set("state", state);
      window.location.assign(url.toString());
    } finally { setBusy(null); }
  }

  async function remove(app: AppId, connectionId: Id<"connections">) {
    setBusy(connectionId);
    try { await disconnect({ app, connectionId }); }
    finally { setBusy(null); }
  }

  const rows: Row[] = visibleApps.map((app) => ({
    ...app, accounts: statuses?.find((status) => status.app === app.id)?.accounts,
  }));
  const columns: DataTableColumn<Row>[] = [
    { id: "app", header: "App", cell: ({ row: { original: row } }) => (
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted"><HugeiconsIcon icon={appIcon(row.id)} strokeWidth={2} /></div>
        <div><p className="font-medium">{row.name}</p><p className="text-sm text-muted-foreground">{row.description}</p></div>
      </div>
    ) },
    { id: "accounts", header: "Connected accounts", cell: ({ row: { original: row } }) =>
      row.accounts === undefined ? <Skeleton className="h-5 w-28" /> : row.accounts.length === 0 ? <span className="text-muted-foreground">—</span> :
      <div className="space-y-2">{row.accounts.map((account) => <div key={account.id} className="flex items-center gap-2">
        <span className="break-all text-sm">{account.login}</span>
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void remove(row.id, account.id)} aria-label={`Disconnect ${account.login} from ${row.name}`}>Disconnect</Button>
      </div>)}</div>
    },
    { id: "status", header: "Status", cell: ({ row: { original: row } }) => row.accounts === undefined ? <Skeleton className="h-5 w-20" /> : <Badge variant={row.accounts.length ? "outline" : "secondary"}>{row.accounts.length ? `${row.accounts.length} connected` : "Off"}</Badge> },
    { id: "connect", header: () => <span className="sr-only">Connect</span>, cell: ({ row: { original: row } }) => <Button variant="outline" size="sm" disabled={row.accounts === undefined || busy !== null} onClick={() => void connect(row.id)}>{row.accounts?.length ? "Add account" : "Connect"}</Button> },
  ];
  return <>
    <DataTable data={rows} columns={columns} getRowKey={(row) => row.id} />
    {CONNECTION_APPS.length > PAGE_SIZE ? <div className="mt-4 flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
      <span className="text-sm">Page {page + 1}</span>
      <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= CONNECTION_APPS.length} onClick={() => setPage(page + 1)}>Next</Button>
    </div> : null}
  </>;
}
