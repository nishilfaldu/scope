"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Alert02Icon, GithubIcon } from "@hugeicons/core-free-icons";
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
  GITHUB_CONNECT_URL,
  type ProviderId,
} from "@/lib/connections";

function providerIcon(id: ProviderId) {
  switch (id) {
    case "github":
      return GithubIcon;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function ConnectionsBoard() {
  const github = useQuery(api.connections.status, { provider: "github" });
  const disconnect = useAction(api.connections.disconnect);
  const [disconnecting, setDisconnecting] = useState<ProviderId | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const githubParam = url.searchParams.get("github");
    if (!githubParam) {
      return;
    }
    if (githubParam === "denied") {
      setConnectError("GitHub access was denied.");
    } else if (githubParam !== "connected") {
      const reason = url.searchParams.get("reason");
      setConnectError(
        (reason && CONNECT_ERRORS[reason]) ||
          "GitHub connect failed. Flip the toggle again.",
      );
    }
    url.searchParams.delete("github");
    url.searchParams.delete("reason");
    const search = url.searchParams.toString();
    window.history.replaceState(
      {},
      "",
      search.length > 0 ? `${url.pathname}?${search}` : url.pathname,
    );
  }, []);

  function statusFor(id: ProviderId) {
    switch (id) {
      case "github":
        return github;
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
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
    switch (id) {
      case "github": {
        setConnectError(null);
        const connect = new URL(GITHUB_CONNECT_URL);
        connect.searchParams.set(
          "returnTo",
          `${window.location.origin}/connections`,
        );
        window.location.assign(connect.toString());
        return;
      }
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
  }

  return (
    <BoardShell title="Connections">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        {connectError && github?.connected !== true ? (
          <div className="px-4 lg:px-6">
            <Alert variant="destructive">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
              <AlertTitle>GitHub connect failed</AlertTitle>
              <AlertDescription>{connectError}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="px-4 lg:px-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Connections</CardTitle>
              <CardDescription>
                Apps the board can act through as you. Tokens stay on the
                server.
              </CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead>Account</TableHead>
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
