"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ALL_APPS, APP_LABELS, type AppId } from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

export function PassportApps({ passportId }: { passportId: string }) {
  const passport = useQuery(api.tables.passports.queries.get, { passportId });
  const [setApp, isToggling] = useErrorCatchingMutation(
    api.tables.passports.mutations.setApp,
    {
      successMessage: (args) =>
        args.enabled
          ? `${APP_LABELS[args.app]} enabled`
          : `${APP_LABELS[args.app]} disabled`,
    },
  );

  function handleToggle(app: AppId, enabled: boolean) {
    if (!passport) return;
    void setApp({
      passportToken: passport.token,
      app,
      enabled,
    });
  }

  if (passport === undefined) {
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

  if (passport === null) {
    return null;
  }

  return (
    <div className="border-t px-6 py-4">
      <p className="text-xs text-muted-foreground">Apps</p>
      {ALL_APPS.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No apps available.</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ALL_APPS.map((app) => {
            const on = passport.apps.includes(app);
            return (
              <label
                key={app}
                className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2"
              >
                <span className="text-sm">{APP_LABELS[app]}</span>
                <Switch
                  checked={on}
                  disabled={passport.status !== "active" || isToggling}
                  onCheckedChange={(checked) => handleToggle(app, checked)}
                  aria-label={`${APP_LABELS[app]} on this passport`}
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
