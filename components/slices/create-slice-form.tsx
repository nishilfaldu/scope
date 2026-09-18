"use client";

import { api } from "@/convex/_generated/api";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { AccountBindings, bindingsFor } from "@/components/connections/account-bindings";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useAppForm } from "@/components/form";
import {
  ALL_APPS,
  APP_HINTS,
  APP_LABELS,
  MINT_POLICY_ITEMS,
  TTL_OPTIONS,
  type AppId,
  type MintPolicy,
} from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 50;

const DEFAULT_TTL_MS = TTL_OPTIONS[1]?.ttlMs ?? 60 * 60 * 1000;
const TTL_ITEMS = TTL_OPTIONS.map((option) => ({
  value: String(option.ttlMs),
  label: option.label,
}));

export type CreatedSlice = {
  sliceToken: string;
  sliceSecret: string;
  name: string;
};

export function CreateSliceForm({
  onCreated,
}: {
  onCreated: (result: CreatedSlice) => void;
}) {
  const [page, setPage] = useState(0);
  const [selectedPage, setSelectedPage] = useState(0);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const matchingApps = ALL_APPS.filter((app) => APP_LABELS[app].toLowerCase().includes(search.toLowerCase()));
  const lastPage = Math.max(0, Math.ceil(matchingApps.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleApps = matchingApps.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const statuses = useQuery(api.tables.connections.queries.statusesForApps, { apps: visibleApps });
  const [selected, setSelected] = useState<Partial<Record<AppId, Id<"connections">>>>({});
  const connectedApps = new Set(statuses?.filter((status) => status.connected).map((status) => status.app));
  const appOptions = visibleApps.map((app) => {
    const connected = connectedApps.has(app);
    return {
      value: app,
      title: APP_LABELS[app],
      description: connected ? APP_HINTS[app] : "Connect this provider first.",
      disabled: !connected,
    };
  });

  const [createSlice] = useErrorCatchingMutation(
    api.tables.slices.mutations.create,
    { successMessage: "Slice created" },
  );

  const form = useAppForm({
    defaultValues: {
      name: "",
      ttlMs: String(DEFAULT_TTL_MS),
      mintPolicy: "auto" as MintPolicy,
      apps: [] as AppId[],
    },
    onSubmit: async ({ value, formApi }) => {
      const result = await createSlice({
        name: value.name.trim() || "Untitled agent",
        ttlMs: Number(value.ttlMs),
        apps: value.apps,
        bindings: bindingsFor(value.apps, selected),
        mintPolicy: value.mintPolicy,
      });
      if (result === undefined) return;
      onCreated({
        sliceToken: result.sliceToken,
        sliceSecret: result.sliceSecret,
        name: result.name,
      });
      formApi.reset();
    },
  });

  return (
    <form.AppForm>
      <form.Form>
        <form.AppField name="name">
          {(field) => (
            <field.TextField label="Name" placeholder="e.g. PR agent" />
          )}
        </form.AppField>
        <form.AppField name="ttlMs">
          {(field) => (
            <field.SelectField label="Time to live" items={TTL_ITEMS} />
          )}
        </form.AppField>
        <form.AppField name="mintPolicy">
          {(field) => (
            <field.SelectField
              label="Mint policy"
              items={[...MINT_POLICY_ITEMS]}
            />
          )}
        </form.AppField>
        <form.AppField
          name="apps"
          validators={{
            onSubmit: ({ value }) =>
              value.length === 0 ? "Turn on at least one app." : undefined,
          }}
        >
          {(field) => {
            const selectedMatching = field.state.value.filter((app) => APP_LABELS[app].toLowerCase().includes(search.toLowerCase()));
            const selectedLastPage = Math.max(0, Math.ceil(selectedMatching.length / PAGE_SIZE) - 1);
            const selectedCurrentPage = Math.min(selectedPage, selectedLastPage);
            const shownOptions = selectedOnly
              ? selectedMatching.slice(selectedCurrentPage * PAGE_SIZE, (selectedCurrentPage + 1) * PAGE_SIZE).map((app) => ({ value: app, title: APP_LABELS[app], description: APP_HINTS[app] }))
              : appOptions;
            const total = selectedOnly ? selectedMatching.length : matchingApps.length;
            const activePage = selectedOnly ? selectedCurrentPage : currentPage;
            const activeLastPage = selectedOnly ? selectedLastPage : lastPage;
            const setActivePage = selectedOnly ? setSelectedPage : setPage;
            return <>
              <div className="mb-3 flex flex-wrap gap-2">
                <Input aria-label="Find an app" placeholder="Find an app…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); setSelectedPage(0); }} className="max-w-xs" />
                <Button type="button" variant={selectedOnly ? "secondary" : "outline"} size="sm" onClick={() => { setSelectedOnly(!selectedOnly); setPage(0); setSelectedPage(0); }}>Selected only</Button>
              </div>
              <field.CheckboxGroupField legend={`Apps (${field.state.value.length} selected)`} options={shownOptions} />
              {total === 0 ? <p className="text-sm text-muted-foreground">No matching apps.</p> : null}
              {total > PAGE_SIZE ? <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={activePage === 0} onClick={() => setActivePage(activePage - 1)}>Previous apps</Button>
                <span className="text-sm">Page {activePage + 1} of {activeLastPage + 1}</span>
                <Button type="button" variant="outline" size="sm" disabled={activePage === activeLastPage} onClick={() => setActivePage(activePage + 1)}>Next apps</Button>
              </div> : null}
            </>;
          }}
        </form.AppField>
        {page === 0 && connectedApps.size === 0 && statuses !== undefined ? (
          <p className="text-sm text-muted-foreground">
            <Link href="/connections" className="underline">
              Connect an account
            </Link>{" "}
            before selecting its app.
          </p>
        ) : null}
        <form.Subscribe selector={(state) => state.values.apps}>
          {(apps) => <AccountBindings apps={apps} selected={selected} onChange={(app, id) => setSelected((current) => ({ ...current, [app]: id }))} />}
        </form.Subscribe>
        <div className="sticky bottom-0 z-10 border-t bg-popover py-3">
          <form.Subscribe selector={(state) => state.values.apps}>
            {(apps) => <form.SubmitButton pendingLabel="Creating…" disabled={apps.length === 0 || bindingsFor(apps, selected).length !== apps.length}>
              Create slice
            </form.SubmitButton>}
          </form.Subscribe>
        </div>
      </form.Form>
    </form.AppForm>
  );
}
