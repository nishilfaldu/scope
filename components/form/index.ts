"use client";

import { createFormHook } from "@tanstack/react-form";

import {
  fieldContext,
  formContext,
  useFieldContext,
  useFormContext,
} from "@/components/form/context";
import {
  CheckboxGroupField,
  SelectField,
  TextField,
} from "@/components/form/fields";
import { Form, SubmitButton } from "@/components/form/form";

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    SelectField,
    CheckboxGroupField,
  },
  formComponents: {
    Form,
    SubmitButton,
  },
});

export { useFieldContext, useFormContext };
