"use client";

import { api } from "@/convex/_generated/api";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AccountBindings,
  bindingsFor,
} from "@/components/connections/account-bindings";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useAppForm } from "@/components/form";
import {
  ALL_APPS,
  APP_LABELS,
  APP_PERMISSIONS,
  TTL_OPTIONS,
  type AppId,
  type MintPolicy,
} from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 50;

const DEFAULT_TTL_MS = TTL_OPTIONS[1]?.ttlMs ?? 60 * 60 * 1000;
const TTL_ITEMS = TTL_OPTIONS.map((option) => ({
  value: String(option.ttlMs),
  label: option.label,
}));
const POLICY_ITEMS = [
  { value: "auto", label: "Allow automatically" },
  { value: "approve", label: "Ask me before each token" },
];

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
  const visibleApps = ALL_APPS.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const statuses = useQuery(api.tables.connections.queries.statusesForApps, {
    apps: visibleApps,
  });
  const [selected, setSelected] = useState<
    Partial<Record<AppId, Id<"connections">[]>>
  >({});
  const connectedApps = new Set(
    statuses?.filter((status) => status.connected).map((status) => status.app),
  );
  const appOptions = visibleApps
    .filter((app) => connectedApps.has(app))
    .map((app) => ({
      value: app,
      title: APP_LABELS[app],
      description: APP_PERMISSIONS[app],
    }));

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
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-end gap-2">
            <Link
              href="/connections"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Manage connections
            </Link>
          </div>
          <form.AppField
            name="apps"
            validators={{
              onSubmit: ({ value }) =>
                value.length === 0 ? "Choose at least one app." : undefined,
            }}
          >
            {(field) =>
              statuses === undefined ? (
                <div
                  className="grid gap-2 sm:grid-cols-2"
                  aria-label="Loading connected apps"
                >
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                </div>
              ) : appOptions.length > 0 ? (
                <field.CheckboxGroupField
                  legend={`Connected apps (${field.state.value.length} selected)`}
                  options={appOptions}
                />
              ) : (
                <div className="rounded-xl border border-dashed p-5 text-sm">
                  <p className="font-medium">No connected apps on this page</p>
                  <Link
                    href="/connections"
                    className="mt-3 inline-block font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Go to Connections
                  </Link>
                </div>
              )
            }
          </form.AppField>
          {ALL_APPS.length > PAGE_SIZE ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous apps
              </Button>
              <span className="text-sm">
                Page {page + 1} of {Math.ceil(ALL_APPS.length / PAGE_SIZE)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={(page + 1) * PAGE_SIZE >= ALL_APPS.length}
                onClick={() => setPage(page + 1)}
              >
                Next apps
              </Button>
            </div>
          ) : null}
        </section>
        <form.Subscribe selector={(state) => state.values.apps}>
          {(apps) => (
            <AccountBindings
              compact
              apps={apps}
              selected={selected}
              onChange={(app, ids) =>
                setSelected((current) => ({ ...current, [app]: ids }))
              }
            />
          )}
        </form.Subscribe>
        <section className="space-y-4 border-t pt-5">
          <h3 className="font-medium">Access rules</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  label="Name (optional)"
                  placeholder="e.g. PR agent"
                  maxLength={80}
                />
              )}
            </form.AppField>
            <form.AppField name="ttlMs">
              {(field) => (
                <field.SelectField label="Expires after" items={TTL_ITEMS} />
              )}
            </form.AppField>
          </div>
          <form.AppField name="mintPolicy">
            {(field) => (
              <field.SelectField label="Token requests" items={POLICY_ITEMS} />
            )}
          </form.AppField>
        </section>
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t bg-popover py-3">
          <form.Subscribe selector={(state) => state.values.apps}>
            {(apps) => (
              <>
                <span className="text-sm text-muted-foreground">
                  {apps.length} {apps.length === 1 ? "app" : "apps"} selected
                </span>
                <form.SubmitButton
                  pendingLabel="Creating…"
                  disabled={
                    apps.length === 0 ||
                    apps.some((app) => !selected[app]?.length)
                  }
                >
                  Create slice
                </form.SubmitButton>
              </>
            )}
          </form.Subscribe>
        </div>
      </form.Form>
    </form.AppForm>
  );
}
