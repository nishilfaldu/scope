"use client";

import type { ComponentProps } from "react";

import { useFieldContext } from "@/components/form/context";
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
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function fieldIsInvalid(field: {
  state: { meta: { errors: unknown[] } };
}) {
  return field.state.meta.errors.length > 0;
}

function fieldErrorItems(errors: unknown[]) {
  return errors.flatMap((error) => {
    if (error == null) return [];
    if (typeof error === "string") return [{ message: error }];
    if (
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return [{ message: error.message }];
    }
    return [{ message: String(error) }];
  });
}

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

export function SelectField({
  label,
  description,
  items,
  placeholder,
}: {
  label: string;
  description?: string;
  items: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
}) {
  const field = useFieldContext<string>();
  const isInvalid = fieldIsInvalid(field);

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Select
        items={items}
        name={field.name}
        value={field.state.value}
        onValueChange={(value) => {
          if (value == null) return;
          field.handleChange(value);
        }}
      >
        <SelectTrigger
          id={field.name}
          aria-invalid={isInvalid}
          className="w-full"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {isInvalid ? (
        <FieldError errors={fieldErrorItems(field.state.meta.errors)} />
      ) : null}
    </Field>
  );
}

export function CheckboxGroupField<T extends string>({
  legend,
  options,
}: {
  legend: string;
  options: ReadonlyArray<{
    value: T;
    title: string;
    description?: string;
  }>;
}) {
  const field = useFieldContext<T[]>();
  const isInvalid = fieldIsInvalid(field);

  return (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <FieldGroup data-slot="checkbox-group">
        {options.map((option) => {
          const id = `${field.name}-${option.value}`;
          return (
            <Field
              key={option.value}
              orientation="horizontal"
              data-invalid={isInvalid}
            >
              <Checkbox
                id={id}
                name={field.name}
                aria-invalid={isInvalid}
                checked={field.state.value.includes(option.value)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    if (field.state.value.includes(option.value)) return;
                    field.handleChange([...field.state.value, option.value]);
                    return;
                  }
                  field.handleChange(
                    field.state.value.filter((value) => value !== option.value),
                  );
                }}
              />
              <FieldContent>
                <FieldLabel htmlFor={id}>{option.title}</FieldLabel>
                {option.description ? (
                  <FieldDescription>{option.description}</FieldDescription>
                ) : null}
              </FieldContent>
            </Field>
          );
        })}
      </FieldGroup>
      {isInvalid ? (
        <FieldError errors={fieldErrorItems(field.state.meta.errors)} />
      ) : null}
    </FieldSet>
  );
}
