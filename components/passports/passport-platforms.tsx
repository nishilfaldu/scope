"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import {
  ALL_APPS,
  APP_LABELS,
  type AppId,
} from "@/lib/capabilities";

export function PassportPlatforms({
  token,
  apps,
  lifetimeStatus,
}: {
  token: string;
  apps: AppId[];
  lifetimeStatus: "active" | "revoked" | "expired";
}) {
  const [toggling, setToggling] = useState<string | null>(null);
  const setPlatform = useMutation(api.tables.passports.mutations.setPlatform);

  async function handleToggle(platform: AppId, enabled: boolean) {
    setToggling(platform);
    try {
      await setPlatform({ passportId: token, platform, enabled });
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="border-t px-6 py-4">
      <p className="text-xs text-muted-foreground">Platforms</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {ALL_APPS.map((app) => {
          const on = apps.includes(app);
          return (
            <label
              key={app}
              className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2"
            >
              <span className="text-sm">{APP_LABELS[app]}</span>
              <Switch
                checked={on}
                disabled={lifetimeStatus !== "active" || toggling === app}
                onCheckedChange={(checked) => void handleToggle(app, checked)}
                aria-label={`${APP_LABELS[app]} on this passport`}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
