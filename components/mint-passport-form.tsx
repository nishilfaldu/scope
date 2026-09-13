"use client";

import { useState } from "react";
import { useMutation } from "convex/react";

import { api } from "../convex/_generated/api";
import { useAppForm } from "@/components/form";
import { FieldError } from "@/components/ui/field";
import {
  ALL_APPS,
  APP_HINTS,
  APP_LABELS,
  TTL_OPTIONS,
  type AppId,
} from "@/lib/capabilities";

const DEFAULT_TTL_MS = TTL_OPTIONS[1]?.ttlMs ?? 60 * 60 * 1000;

const TTL_ITEMS = TTL_OPTIONS.map((opt) => ({
  value: String(opt.ttlMs),
  label: opt.label,
}));

const APP_OPTIONS = ALL_APPS.map((app) => ({
  value: app,
  title: APP_LABELS[app],
  description: APP_HINTS[app],
}));

export function MintPassportForm({
  onMinted,
}: {
  onMinted: (result: {
    passportId: string;
    invokeKey: string;
    name: string;
  }) => void;
}) {
  const mint = useMutation(api.passports.mint);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: {
      name: "",
      ttlMs: String(DEFAULT_TTL_MS),
      apps: [] as AppId[],
    },
    onSubmit: async ({ value, formApi }) => {
      setSubmitError(null);
      try {
        const result = await mint({
          name: value.name.trim() || "Untitled agent",
          ttlMs: Number(value.ttlMs),
          apps: value.apps,
        });
        onMinted({
          passportId: result.passportId,
          invokeKey: result.invokeKey,
          name: result.name,
        });
        formApi.reset();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Mint failed");
      }
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
              legend="Platforms"
              options={APP_OPTIONS}
            />
          )}
        </form.AppField>
        {submitError ? <FieldError>{submitError}</FieldError> : null}
        <form.SubmitButton pendingLabel="Minting…">
          Mint passport
        </form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
