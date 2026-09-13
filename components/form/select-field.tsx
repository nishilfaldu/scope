"use client";

import { useFieldContext } from "@/components/form/context";
import { fieldErrorItems, fieldIsInvalid } from "@/components/form/field-errors";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
          if (value != null) field.handleChange(value);
        }}
      >
        <SelectTrigger id={field.name} aria-invalid={isInvalid} className="w-full">
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
