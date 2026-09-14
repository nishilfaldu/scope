"use client";

import { api } from "@/convex/_generated/api";
import { useAppForm } from "@/components/form";
import {
  ALL_APPS,
  APP_HINTS,
  APP_LABELS,
  TTL_OPTIONS,
  type AppId,
} from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

const DEFAULT_TTL_MS = TTL_OPTIONS[1]?.ttlMs ?? 60 * 60 * 1000;
const TTL_ITEMS = TTL_OPTIONS.map((option) => ({
  value: String(option.ttlMs),
  label: option.label,
}));
const APP_OPTIONS = ALL_APPS.map((app) => ({
  value: app,
  title: APP_LABELS[app],
  description: APP_HINTS[app],
}));

export type CreatedPassport = {
  passportToken: string;
  passportSecret: string;
  name: string;
};

export function CreatePassportForm({
  onCreated,
}: {
  onCreated: (result: CreatedPassport) => void;
}) {
  const [createPassport] = useErrorCatchingMutation(
    api.tables.passports.mutations.create,
    { successMessage: "Passport created" },
  );

  const form = useAppForm({
    defaultValues: {
      name: "",
      ttlMs: String(DEFAULT_TTL_MS),
      apps: [] as AppId[],
    },
    onSubmit: async ({ value, formApi }) => {
      const result = await createPassport({
        name: value.name.trim() || "Untitled agent",
        ttlMs: Number(value.ttlMs),
        apps: value.apps,
      });
      if (result === undefined) return;
      onCreated({
        passportToken: result.passportToken,
        passportSecret: result.passportSecret,
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
        <form.AppField
          name="apps"
          validators={{
            onSubmit: ({ value }) =>
              value.length === 0 ? "Turn on at least one app." : undefined,
          }}
        >
          {(field) => (
            <field.CheckboxGroupField
              legend="Apps"
              options={APP_OPTIONS}
            />
          )}
        </form.AppField>
        <form.SubmitButton pendingLabel="Creating…">
          Create passport
        </form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
