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
} from "@/components/form/checkbox-group-field";
import { Form } from "@/components/form/app-form";
import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";

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
