"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { APP_LABELS, type AppId } from "@/lib/capabilities";

type Status = { app: AppId; accounts: { id: Id<"connections">; login: string }[] };
export type Binding = { app: AppId; connectionId: Id<"connections"> };

export function bindingsFor(apps: readonly AppId[], statuses: readonly Status[] | undefined, selected: Partial<Record<AppId, Id<"connections">>>): Binding[] {
  return apps.flatMap((app) => {
    const accounts = statuses?.find((entry) => entry.app === app)?.accounts ?? [];
    const account = accounts.find((entry) => entry.id === selected[app]) ?? (accounts.length === 1 ? accounts[0] : undefined);
    return account ? [{ app, connectionId: account.id }] : [];
  });
}

export function AccountBindings({ apps, statuses, selected, onChange }: {
  apps: readonly AppId[];
  statuses: readonly Status[] | undefined;
  selected: Partial<Record<AppId, Id<"connections">>>;
  onChange: (app: AppId, id: Id<"connections">) => void;
}) {
  if (apps.length === 0) return null;
  return <div className="space-y-3">
    <p className="text-sm font-medium">Accounts for this grant</p>
    {apps.map((app) => {
      const accounts = statuses?.find((entry) => entry.app === app)?.accounts ?? [];
      return <label key={app} className="block space-y-1 text-sm">
        <span>{APP_LABELS[app]}</span>
        <select className="w-full rounded-md border bg-background px-3 py-2" value={selected[app] ?? (accounts.length === 1 ? accounts[0].id : "")} onChange={(event) => onChange(app, event.target.value as Id<"connections">)} required>
          <option value="" disabled>{accounts.length ? "Choose an account" : "Connect an account first"}</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.login}</option>)}
        </select>
      </label>;
    })}
  </div>;
}
