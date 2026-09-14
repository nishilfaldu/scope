"use client";

import { useState, type ReactNode } from "react";

import {
  CreatePassportForm,
  type CreatedPassport,
} from "@/components/passports/create-passport-form";
import { PassportCredentials } from "@/components/passports/passport-credentials";
import { BaseModal } from "@/components/shared/base-modal";

export function CreatePassportDialog({
  children,
}: {
  children: (options: { openModal: () => void }) => ReactNode;
}) {
  const [createdPassport, setCreatedPassport] =
    useState<CreatedPassport | null>(null);

  function handleCreated(passport: CreatedPassport) {
    setCreatedPassport(passport);
  }

  function handleClose() {
    window.setTimeout(() => setCreatedPassport(null), 150);
  }

  return (
    <BaseModal
      title={createdPassport ? "Passport created" : "Create a passport"}
      description={
        createdPassport
          ? "Copy these credentials now. The invoke key will not be shown again."
          : "Create a time-boxed identity for one job and choose which connected apps it can request."
      }
      content={
        createdPassport ? (
          <PassportCredentials passport={createdPassport} />
        ) : (
          <CreatePassportForm onCreated={handleCreated} />
        )
      }
      maxWidth="sm:max-w-lg"
      showFooter={createdPassport != null}
      onClose={handleClose}
    >
      {({ openModal }) =>
        children({
          openModal: () => {
            setCreatedPassport(null);
            openModal();
          },
        })
      }
    </BaseModal>
  );
}
