"use client";

import {
  ArrowDown01Icon,
  Chart01Icon,
  CloudIcon,
  DatabaseIcon,
  GithubIcon,
  GoogleIcon,
  Notion01Icon,
  SlackIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ConvexPagination } from "@/components/shared/convex-pagination";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  APP_CONNECT_URL,
  type AppId,
  CONNECTION_APPS,
} from "@/lib/connections";

const PAGE_SIZE = 10;

function appIcon(app: AppId) {
  if (["gmail", "calendar", "drive", "docs", "sheets"].includes(app))
    return GoogleIcon;
  switch (app) {
    case "github":
      return GithubIcon;
    case "slack":
      return SlackIcon;
    case "airtable":
    case "zoom":
      return DatabaseIcon;
    case "notion":
      return Notion01Icon;
    case "linear":
      return Chart01Icon;
    case "vercel":
      return CloudIcon;
    default:
      return GoogleIcon;
  }
}

type Row = (typeof CONNECTION_APPS)[number] & {
  accounts:
    | { id: Id<"connections">; login: string; providerUserId: string }[]
    | undefined;
};

function ConnectionRow({
  app,
  busy,
  onConnect,
  onDisconnect,
}: {
  app: Row;
  busy: boolean;
  onConnect: (app: AppId) => void;
  onDisconnect: (app: AppId, connectionId: Id<"connections">) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = app.accounts?.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <div className="px-4 py-2">
        <CollapsibleTrigger
          className="flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${open ? "Hide" : "Show"} ${app.name} accounts`}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
            <HugeiconsIcon icon={appIcon(app.id)} strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
            <span className="block font-medium">{app.name}</span>
            <span className="block min-w-0 truncate text-sm text-muted-foreground sm:flex-1">{app.description}</span>
          </span>
          <span className="shrink-0 text-sm text-muted-foreground">
            {count === undefined ? <Skeleton className="h-5 w-6 sm:w-16" /> : (
              <>
                <span className="sm:hidden">{count}</span>
                <span className="hidden sm:inline">{count} {count === 1 ? "account" : "accounts"}</span>
              </>
            )}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="border-t bg-muted/20">
        <div className="flex items-center justify-between gap-3 px-6 py-3">
          <p className="text-sm text-muted-foreground">
            {count === 0 ? "No accounts connected yet." : "Connected accounts"}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={count === undefined || busy}
            onClick={() => onConnect(app.id)}
          >
            {count ? "Add account" : "Connect"}
          </Button>
        </div>
        {count === undefined ? (
          <Skeleton className="mx-6 my-4 h-8 w-48" />
        ) : count > 0 ? (
          <ul className="divide-y border-t px-6">
            {app.accounts?.map((account) => (
              <li key={account.id} className="flex min-w-0 items-center justify-between gap-3 py-3 pl-9">
                <span className="min-w-0 break-all text-sm">{account.login}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onDisconnect(app.id, account.id)}
                  aria-label={`Disconnect ${account.login} from ${app.name}`}
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ConnectionsTable() {
  const [page, setPage] = useState(0);
  const visibleApps = CONNECTION_APPS.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  const statuses = useQuery(api.tables.connections.queries.statusesForApps, {
    apps: visibleApps.map((app) => app.id),
  });
  const disconnect = useAction(api.tables.connections.actions.disconnect);
  const startOAuth = useMutation(api.tables.oauthStates.mutations.start);
  const [busy, setBusy] = useState<string | null>(null);

  async function connect(app: AppId) {
    setBusy(app);
    try {
      const { state } = await startOAuth({
        app,
        returnTo: `${window.location.origin}/connections`,
      });
      const url = new URL(APP_CONNECT_URL[app]);
      url.searchParams.set("state", state);
      window.location.assign(url.toString());
    } finally {
      setBusy(null);
    }
  }

  async function remove(app: AppId, connectionId: Id<"connections">) {
    setBusy(connectionId);
    try {
      await disconnect({ app, connectionId });
    } finally {
      setBusy(null);
    }
  }

  const rows: Row[] = visibleApps.map((app) => ({
    ...app,
    accounts: statuses?.find((status) => status.app === app.id)?.accounts,
  }));
  return (
    <div>
      {rows.map((app) => (
        <ConnectionRow
          key={app.id}
          app={app}
          busy={busy !== null}
          onConnect={(appId) => void connect(appId)}
          onDisconnect={(appId, connectionId) => void remove(appId, connectionId)}
        />
      ))}
      {CONNECTION_APPS.length > PAGE_SIZE ? (
        <div className="border-t">
          <ConvexPagination
            canPrevious={page > 0}
            canNext={(page + 1) * PAGE_SIZE < CONNECTION_APPS.length}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        </div>
      ) : null}
    </div>
  );
}
