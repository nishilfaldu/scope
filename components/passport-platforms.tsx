"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import {
  ALL_APPS,
  APP_LABELS,
  formatRemaining,
  type AppId,
} from "@/lib/capabilities";

export function PassportPlatforms({
  queryId,
  token,
  apps,
  lifetimeStatus,
  now,
  onChanged,
}: {
  queryId: string;
  token: string;
  apps: AppId[];
  lifetimeStatus: "active" | "revoked" | "expired";
  now: number;
  onChanged: () => void;
}) {
  const [toggling, setToggling] = useState<string | null>(null);
  const liveTokens = useQuery(api.tokens.listLive, { passportId: queryId, now });
  const setPlatform = useMutation(api.passports.setPlatform);

  async function handleToggle(platform: AppId, enabled: boolean) {
    setToggling(platform);
    try {
      await setPlatform({ passportId: token, platform, enabled });
      onChanged();
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
      {liveTokens && liveTokens.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Live tokens:{" "}
          {liveTokens
            .map(
              (token) =>
                `${APP_LABELS[token.platform]} (${formatRemaining(token.expiresAt, now)})`,
            )
            .join(" · ")}
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No live platform tokens. Connecting an account does not grant access
          until a platform is on and the agent mints a token.
        </p>
      )}
    </div>
  );
}
