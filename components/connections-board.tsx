"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import {
  Alert02Icon,
  GithubIcon,
  GoogleIcon,
  SlackIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "../convex/_generated/api";
import { BoardShell } from "@/components/board-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CONNECTION_PROVIDERS,
  CONNECT_ERRORS,
  PROVIDER_CONNECT_URL,
  type ProviderId,
} from "@/lib/connections";

function readOauthReturn(): { provider: ProviderId; message: string } | null {
  if (typeof window === "undefined") {
    return null;
  }
  const url = new URL(window.location.href);
  const providers: ProviderId[] = ["github", "google", "slack"];
  for (const id of providers) {
    const value = url.searchParams.get(id);
    if (!value) {
      continue;
    }
    if (value === "connected") {
      return null;
    }
    if (value === "denied") {
      return { provider: id, message: "Access was denied." };
    }
    const reason = url.searchParams.get("reason");
    return {
      provider: id,
      message:
        (reason && CONNECT_ERRORS[reason]) ||
        "Connect failed. Flip the toggle again.",
    };
  }
  return null;
}

function providerIcon(id: ProviderId) {
  switch (id) {
    case "github":
      return GithubIcon;
    case "google":
      return GoogleIcon;
    case "slack":
      return SlackIcon;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function ConnectionsBoard() {
  const statuses = useQuery(api.connections.listStatuses);
  const disconnect = useAction(api.connections.disconnect);
  const [disconnecting, setDisconnecting] = useState<ProviderId | null>(null);
  const [connectBanner] = useState(readOauthReturn);

  useEffect(() => {
    const url = new URL(window.location.href);
    const providers: ProviderId[] = ["github", "google", "slack"];
    let dirty = false;
    for (const id of providers) {
      if (url.searchParams.has(id)) {
        url.searchParams.delete(id);
        dirty = true;
      }
    }
    if (url.searchParams.has("reason")) {
      url.searchParams.delete("reason");
      dirty = true;
    }
    if (!dirty) {
      return;
    }
    const search = url.searchParams.toString();
    window.history.replaceState(
      {},
      "",
      search.length > 0 ? `${url.pathname}?${search}` : url.pathname,
    );
  }, []);

  function statusFor(id: ProviderId) {
    const row = statuses?.find((item) => item.provider === id);
    if (!statuses) {
      return undefined;
    }
    if (!row || !row.connected) {
      return { connected: false as const };
    }
    return { connected: true as const, login: row.login ?? id };
  }

  async function toggle(id: ProviderId) {
    const status = statusFor(id);
    if (status === undefined || disconnecting) {
      return;
    }
    if (status.connected) {
      setDisconnecting(id);
      try {
        await disconnect({ provider: id });
      } finally {
        setDisconnecting(null);
      }
      return;
    }
    const connect = new URL(PROVIDER_CONNECT_URL[id]);
    connect.searchParams.set(
      "returnTo",
      `${window.location.origin}/connections`,
    );
    window.location.assign(connect.toString());
  }

  return (
    <BoardShell title="Connections">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        {connectBanner ? (
          <div className="px-4 lg:px-6">
            <Alert variant="destructive">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
              <AlertTitle>Connect failed</AlertTitle>
              <AlertDescription>{connectBanner.message}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="px-4 lg:px-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Connections</CardTitle>
              <CardDescription>
                Three logins: GitHub, Google, and Slack. Google covers Gmail,
                Calendar, Drive, Docs, and Sheets. Connecting an account does
                not give any agent access by itself.
              </CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">
                    <span className="sr-only">Connect</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CONNECTION_PROVIDERS.map((provider) => {
                  const status = statusFor(provider.id);
                  const Icon = providerIcon(provider.id);
                  return (
                    <TableRow key={provider.id}>
                      <TableCell>
                        <div className="flex items-start gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                            <HugeiconsIcon icon={Icon} strokeWidth={2} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium">{provider.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {provider.description}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {status === undefined ? (
                          <Skeleton className="h-5 w-28" />
                        ) : status.connected ? (
                          status.login
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {status === undefined ? (
                          <Skeleton className="h-5 w-20" />
                        ) : status.connected ? (
                          <Badge variant="outline">Connected</Badge>
                        ) : (
                          <Badge variant="secondary">Off</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={status?.connected === true}
                          disabled={
                            status === undefined ||
                            disconnecting === provider.id
                          }
                          onCheckedChange={() => void toggle(provider.id)}
                          aria-label={`${provider.name} connection`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </BoardShell>
  );
}
