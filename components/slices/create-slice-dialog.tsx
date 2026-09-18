"use client";

import { useState, type ReactNode } from "react";

import {
  CreateSliceForm,
  type CreatedSlice,
} from "@/components/slices/create-slice-form";
import { SliceCredentials } from "@/components/slices/slice-credentials";
import { BaseModal } from "@/components/shared/base-modal";

export function CreateSliceDialog({
  children,
}: {
  children: (options: { openModal: () => void }) => ReactNode;
}) {
  const [createdSlice, setCreatedSlice] =
    useState<CreatedSlice | null>(null);

  function handleCreated(slice: CreatedSlice) {
    setCreatedSlice(slice);
  }

  function handleClose() {
    window.setTimeout(() => setCreatedSlice(null), 150);
  }

  return (
    <BaseModal
      title={createdSlice ? "Slice created" : "Create a slice"}
      description={
        createdSlice
          ? "Copy these credentials now. The slice secret will not be shown again."
          : "Choose the accounts this agent can use, then set its access rules."
      }
      content={
        createdSlice ? (
          <SliceCredentials slice={createdSlice} />
        ) : (
          <CreateSliceForm onCreated={handleCreated} />
        )
      }
      maxWidth="sm:max-w-2xl"
      showFooter={createdSlice != null}
      onClose={handleClose}
    >
      {({ openModal }) =>
        children({
          openModal: () => {
            setCreatedSlice(null);
            openModal();
          },
        })
      }
    </BaseModal>
  );
}
