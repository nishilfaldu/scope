"use client";

import { useState } from "react";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AppIcon } from "@/components/shared/app-icon";
import { EmptyState } from "@/components/shared/empty-state";
import { BrandMark } from "@/components/shared/brand-mark";
import {
  ALL_APPS,
  APP_LABELS,
  effectiveSliceStatus,
  type AppId,
} from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";
import { useNow } from "@/hooks/use-now";

const INITIAL_ACCOUNTS = 5;

export function SliceApps({ sliceId }: { sliceId: string }) {
  const now = useNow();
  const [accountSearch, setAccountSearch] = useState("");
  const statuses = useQuery(api.tables.connections.queries.statusesForApps, {
    apps: [...ALL_APPS],
  });
  const bindings = useQuery(api.tables.slices.queries.bindingsForApps, {
    sliceId: sliceId as Id<"slices">,
    apps: [...ALL_APPS],
  });
  const slice = useQuery(api.tables.slices.queries.get, { sliceId });
  const [setBinding, isToggling] = useErrorCatchingMutation(
    api.tables.slices.mutations.setBinding,
    {
      successMessage: (args) =>
        args.enabled
          ? `${APP_LABELS[args.app]} added`
          : `${APP_LABELS[args.app]} removed`,
    },
  );

  if (slice === undefined)
    return <Skeleton className="h-72 w-full rounded-xl" />;
  if (slice === null) return null;
  const sliceToken = slice.token;

  function toggle(
    app: AppId,
    connectionId: Id<"connections">,
    enabled: boolean,
  ) {
    void setBinding({ connectionId, sliceToken, app, enabled });
  }

  const groups = ALL_APPS.map((app) => {
    const accounts =
      statuses?.find((status) => status.app === app)?.accounts ?? [];
    const appBindings =
      bindings?.filter((binding) => binding.app === app) ?? [];
    return {
      app,
      allowed: appBindings.map((binding) => ({
        connectionId: binding.connectionId,
        login:
          accounts.find((account) => account.id === binding.connectionId)
            ?.login ?? null,
      })),
      available: accounts.filter(
        (account) =>
          !appBindings.some((binding) => binding.connectionId === account.id),
      ),
    };
  });
  const allowed = groups.flatMap((group) =>
    group.allowed.map((account) => ({ app: group.app, ...account })),
  );
  const available = groups.flatMap((group) =>
    group.available.map((account) => ({ app: group.app, ...account })),
  );
  const search = accountSearch.trim().toLocaleLowerCase();
  const shownAvailable = search
    ? available.filter(
        ({ app, login }) =>
          APP_LABELS[app].toLocaleLowerCase().includes(search) ||
          login.toLocaleLowerCase().includes(search),
      )
    : available.slice(0, INITIAL_ACCOUNTS);
  const loaded = statuses !== undefined && bindings !== undefined;
  const active = effectiveSliceStatus(slice, now) === "active";

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-semibold">Account access</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Accounts this agent can use through this grant.
          </p>
        </div>
        <Link
          href="/connections"
          className="text-sm font-medium underline underline-offset-4"
        >
          Connections
        </Link>
      </div>
      <div className="border-t">
        {!loaded ? (
          <div className="divide-y">
            {[0, 1].map((item) => (
              <div key={item} className="flex items-center gap-3 px-5 py-4">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-44" />
                </div>
              </div>
            ))}
          </div>
        ) : allowed.length === 0 ? (
          <EmptyState
            title="No accounts allowed"
            description="This grant currently cannot access any connected account."
            icon={<BrandMark className="size-6" />}
          />
        ) : (
          <div className="divide-y">
            {allowed.map((account) => (
              <div
                key={`${account.app}:${account.connectionId}`}
                className="flex items-center gap-3 px-5 py-3.5 sm:px-6"
              >
                <AppIcon app={account.app} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {APP_LABELS[account.app]}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {account.login ?? "Disconnected account"}
                  </p>
                </div>
                {account.login ? (
                  <Switch
                    checked
                    disabled={!active || isToggling}
                    onCheckedChange={() =>
                      toggle(account.app, account.connectionId, false)
                    }
                    aria-label={`Remove ${account.login}`}
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!active || isToggling}
                    onClick={() =>
                      toggle(account.app, account.connectionId, false)
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {active ? (
        <div className="border-t bg-muted/20 px-5 py-5 sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-sm font-semibold">Add a connected account</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This expands the agent’s access immediately.
              </p>
            </div>
            {available.length > 4 ? (
              <Input
                type="search"
                value={accountSearch}
                onChange={(event) => setAccountSearch(event.target.value)}
                placeholder="Search accounts"
                className="h-9 sm:max-w-56"
              />
            ) : null}
          </div>
          {!loaded ? (
            <Skeleton className="mt-4 h-12 w-full" />
          ) : shownAvailable.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {available.length === 0
                ? "No other connected accounts."
                : "No matching accounts."}
            </p>
          ) : (
            <div className="mt-4 divide-y rounded-lg border bg-background">
              {shownAvailable.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <AppIcon app={account.app} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {APP_LABELS[account.app]}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {account.login}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isToggling}
                    onClick={() => toggle(account.app, account.id, true)}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
