"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ALL_APPS, APP_LABELS, type AppId } from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

export function SliceApps({ sliceId }: { sliceId: string }) {
  const slice = useQuery(api.tables.slices.queries.get, { sliceId: sliceId });
  const [setApp, isToggling] = useErrorCatchingMutation(
    api.tables.slices.mutations.setApp,
    {
      successMessage: (args) =>
        args.enabled
          ? `${APP_LABELS[args.app]} enabled`
          : `${APP_LABELS[args.app]} disabled`,
    },
  );

  function handleToggle(app: AppId, enabled: boolean) {
    if (!slice) return;
    void setApp({
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

  return (
    <div className="border-t px-6 py-4">
      <p className="text-xs text-muted-foreground">Apps</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {ALL_APPS.map((app) => {
          const on = slice.grantApps.includes(app);
          return (
            <label
              key={app}
              className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2"
            >
              <span className="text-sm">{APP_LABELS[app]}</span>
              <Switch
                checked={on}
                disabled={slice.status !== "active" || isToggling}
                onCheckedChange={(checked) => handleToggle(app, checked)}
                aria-label={`${APP_LABELS[app]} on this grant`}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
