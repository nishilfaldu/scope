"use client";

import { type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALL_APPS,
  APP_HINTS,
  APP_LABELS,
  TTL_OPTIONS,
  type AppId,
} from "@/lib/capabilities";

export function MintPassportForm({
  name,
  ttlMs,
  apps,
  minting,
  mintError,
  onNameChange,
  onTtlChange,
  onToggleApp,
  onSubmit,
}: {
  name: string;
  ttlMs: number;
  apps: AppId[];
  minting: boolean;
  mintError: string | null;
  onNameChange: (value: string) => void;
  onTtlChange: (ttlMs: number) => void;
  onToggleApp: (app: AppId) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="passport-name">Name</FieldLabel>
          <Input
            id="passport-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="e.g. PR agent"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="passport-ttl">Time to live</FieldLabel>
          <Select
            items={TTL_OPTIONS.map((opt) => ({
              value: String(opt.ttlMs),
              label: opt.label,
            }))}
            value={String(ttlMs)}
            onValueChange={(value) => {
              if (value == null) return;
              onTtlChange(Number(value));
            }}
          >
            <SelectTrigger id="passport-ttl" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TTL_OPTIONS.map((opt) => (
                <SelectItem key={opt.ttlMs} value={String(opt.ttlMs)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Platforms</FieldLegend>
          {ALL_APPS.map((app) => (
            <Field key={app} orientation="horizontal">
              <Checkbox
                checked={apps.includes(app)}
                onCheckedChange={() => onToggleApp(app)}
              />
              <FieldContent>
                <FieldTitle>{APP_LABELS[app]}</FieldTitle>
                <FieldDescription>{APP_HINTS[app]}</FieldDescription>
              </FieldContent>
            </Field>
          ))}
        </FieldSet>
        {mintError ? <FieldError>{mintError}</FieldError> : null}
        <Button type="submit" disabled={minting}>
          {minting ? "Minting…" : "Mint passport"}
        </Button>
      </FieldGroup>
    </form>
  );
}
