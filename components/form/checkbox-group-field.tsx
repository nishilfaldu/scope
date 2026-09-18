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
      <div data-slot="checkbox-group" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const id = `${field.name}-${option.value}`;
          const selected = field.state.value.includes(option.value);
          return (
            <Field
              key={option.value}
              orientation="horizontal"
              data-invalid={isInvalid}
              data-selected={selected}
              className="rounded-xl border border-border/70 bg-background/40 p-3 transition-colors hover:bg-muted/50 data-[selected=true]:border-primary/60 data-[selected=true]:bg-primary/5"
            >
              <Checkbox
                id={id}
                name={field.name}
                aria-invalid={isInvalid}
                checked={selected}
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
      </div>
      {isInvalid ? (
        <FieldError errors={fieldErrorItems(field.state.meta.errors)} />
      ) : null}
    </FieldSet>
  );
}
