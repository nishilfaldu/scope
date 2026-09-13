"use client";

import type { ComponentProps } from "react";

import { useFormContext } from "@/components/form/context";
import { FieldGroup } from "@/components/ui/field";

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
