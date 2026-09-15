"use client";

import { useFieldContext } from "@/components/form/context";
import {
  fieldErrorItems,
  fieldIsInvalid,
} from "@/components/form/field-errors";
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

export function CheckboxGroupField<T extends string>({
  legend,
  options,
}: {
  legend: string;
  options: ReadonlyArray<{
    value: T;
    title: string;
    description?: string;
    disabled?: boolean;
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
                disabled={option.disabled}
                onCheckedChange={(checked) => {
                  if (checked) {
                    if (!field.state.value.includes(option.value)) {
                      field.handleChange([...field.state.value, option.value]);
                    }
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
