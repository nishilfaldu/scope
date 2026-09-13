"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { useFormContext } from "@/components/form/context";

export function Form({
  children,
  ...props
}: Omit<ComponentProps<"form">, "onSubmit">) {
  const form = useFormContext();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      {...props}
    >
      <FieldGroup>{children}</FieldGroup>
    </form>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ComponentProps<typeof Button> & {
  pendingLabel?: string;
}) {
  const form = useFormContext();

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button type="submit" disabled={isSubmitting} {...props}>
          {isSubmitting && pendingLabel ? pendingLabel : children}
        </Button>
      )}
    </form.Subscribe>
  );
}
