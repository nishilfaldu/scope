"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { DatabaseIcon, GithubIcon, GoogleIcon, SlackIcon, Notion01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  CONNECTION_PROVIDERS,
  PROVIDER_CONNECT_URL,
  type ProviderId,
} from "@/lib/connections";

function providerIcon(id: ProviderId) {
  switch (id) {
    case "github":
      return GithubIcon;
    case "google":
      return GoogleIcon;
    case "slack":
      return SlackIcon;
    case "airtable":
      return DatabaseIcon;
    case "notion":
      return Notion01Icon;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

type ConnectionRow = (typeof CONNECTION_PROVIDERS)[number] & {
  status: { connected: true; login: string } | { connected: false } | undefined;
};

export function ConnectionsTable() {
  const statuses = useQuery(api.tables.connections.queries.listStatuses);
  const disconnect = useAction(api.tables.connections.actions.disconnect);
  const startOAuth = useMutation(api.tables.oauthStates.mutations.start);
  const [disconnecting, setDisconnecting] = useState<ProviderId | null>(null);
  const [connecting, setConnecting] = useState<ProviderId | null>(null);

  function statusFor(id: ProviderId): ConnectionRow["status"] {
    if (!statuses) return undefined;
    const row = statuses.find((item) => item.provider === id);
    return row?.connected
      ? { connected: true, login: row.login ?? id }
      : { connected: false };
  }

  async function toggle(id: ProviderId) {
    const status = statusFor(id);
    if (status === undefined || disconnecting) return;
    if (status.connected) {
      setDisconnecting(id);
      try {
        await disconnect({ provider: id });
      } finally {
        setDisconnecting(null);
      }
      return;
    }
    setConnecting(id);
    try {
      const { state } = await startOAuth({
        provider: id,
        returnTo: `${window.location.origin}/connections`,
      });
      const connect = new URL(PROVIDER_CONNECT_URL[id]);
      connect.searchParams.set("state", state);
      window.location.assign(connect.toString());
    } finally {
      setConnecting(null);
    }
  }

  const rows: ConnectionRow[] = CONNECTION_PROVIDERS.map((provider) => ({
    ...provider,
    status: statusFor(provider.id),
  }));

  const columns: DataTableColumn<ConnectionRow>[] = [
    {
      id: "account",
      header: "Account",
      cell: ({ row: { original: row } }) => {
        const icon = providerIcon(row.id);
        return (
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
              <HugeiconsIcon icon={icon} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="font-medium">{row.name}</p>
              <p className="text-sm text-muted-foreground">{row.description}</p>
            </div>
          </div>
        );
      },
    },
    {
      id: "login",
      header: "Login",
      cell: ({ row: { original: row } }) =>
        row.status === undefined ? (
          <Skeleton className="h-5 w-28" />
        ) : row.status.connected ? (
          row.status.login
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row: { original: row } }) =>
        row.status === undefined ? (
          <Skeleton className="h-5 w-20" />
        ) : row.status.connected ? (
          <Badge variant="outline">Connected</Badge>
        ) : (
          <Badge variant="secondary">Off</Badge>
        ),
    },
    {
      id: "connect",
      header: () => <span className="sr-only">Connect</span>,
      cell: ({ row: { original: row } }) => (
        <Switch
          checked={row.status?.connected === true}
          disabled={
            row.status === undefined ||
            disconnecting === row.id ||
            connecting === row.id
          }
          onCheckedChange={() => void toggle(row.id)}
          aria-label={`${row.name} connection`}
        />
      ),
    },
  ];

  return (
    <DataTable data={rows} columns={columns} getRowKey={(row) => row.id} />
  );
}
