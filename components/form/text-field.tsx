"use client";

import type { ComponentProps } from "react";

import { useFieldContext } from "@/components/form/context";
import { fieldErrorItems, fieldIsInvalid } from "@/components/form/field-errors";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function TextField({
  label,
  description,
  ...inputProps
}: {
  label: string;
  description?: string;
} & Omit<
  ComponentProps<typeof Input>,
  "id" | "name" | "value" | "onBlur" | "onChange"
>) {
  const field = useFieldContext<string>();
  const isInvalid = fieldIsInvalid(field);

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={isInvalid}
        {...inputProps}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {isInvalid ? (
        <FieldError errors={fieldErrorItems(field.state.meta.errors)} />
      ) : null}
    </Field>
  );
}
