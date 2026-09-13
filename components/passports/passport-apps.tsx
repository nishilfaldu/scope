"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ALL_APPS, APP_LABELS, type AppId } from "@/lib/capabilities";

export function PassportApps({ passportId }: { passportId: string }) {
  const passport = useQuery(api.tables.passports.queries.get, { passportId });
  const setPlatform = useMutation(api.tables.passports.mutations.setPlatform);
  const [toggling, setToggling] = useState<string | null>(null);

  async function handleToggle(app: AppId, enabled: boolean) {
    if (!passport) return;
    setToggling(app);
    try {
      await setPlatform({
        passportId: passport.token,
        platform: app,
        enabled,
      });
      toast.success(
        enabled
          ? `${APP_LABELS[app]} enabled`
          : `${APP_LABELS[app]} disabled`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update app",
      );
    } finally {
      setToggling(null);
    }
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
                  disabled={
                    passport.status !== "active" || toggling === app
                  }
                  onCheckedChange={(checked) => void handleToggle(app, checked)}
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
