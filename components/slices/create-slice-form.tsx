"use client";

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useAppForm } from "@/components/form";
import {
  ALL_APPS,
  APP_HINTS,
  APP_LABELS,
  MINT_POLICY_ITEMS,
  TTL_OPTIONS,
  providerForApp,
  type AppId,
  type MintPolicy,
} from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

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
  const statuses = useQuery(api.tables.connections.queries.listStatuses);
  const connectedProviders = new Set(
    statuses
      ?.filter((status) => status.connected)
      .map((status) => status.provider),
  );
  const appOptions = ALL_APPS.map((app) => {
    const connected = connectedProviders.has(providerForApp(app));
    return {
      value: app,
      title: APP_LABELS[app],
      description: connected ? APP_HINTS[app] : "Connect this provider first.",
      disabled: !connected,
    };
  });
  const hasConnections = connectedProviders.size > 0;

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
          {(field) => (
            <field.CheckboxGroupField legend="Apps" options={appOptions} />
          )}
        </form.AppField>
        {!hasConnections && statuses !== undefined ? (
          <p className="text-sm text-muted-foreground">
            <Link href="/connections" className="underline">
              Connect an account
            </Link>{" "}
            before creating a slice.
          </p>
        ) : null}
        <form.SubmitButton pendingLabel="Creating…" disabled={!hasConnections}>
          Create slice
        </form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
