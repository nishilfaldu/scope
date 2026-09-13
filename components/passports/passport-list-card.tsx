"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { CreatePassportDialog } from "@/components/passports/create-passport-dialog";
import { ContentCard } from "@/components/shared/content-card";
import { PassportsTable } from "@/components/passports/passports-table";
import { Button } from "@/components/ui/button";

export function PassportListCard() {
  const passports = useQuery(api.tables.passports.queries.list, {});
  const revoke = useMutation(api.tables.passports.mutations.revoke);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const activeCount = passports?.filter(
    (passport) => passport.lifetimeStatus === "active",
  ).length;

  async function handleCopy(value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue(null), 1500);
  }

  async function handleRevoke(passportId: string) {
    setRevokingId(passportId);
    try {
      await revoke({ passportId });
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <ContentCard
      title="Passports"
      description={
        passports === undefined
          ? "Loading cards…"
          : passports.length === 0
            ? "Create a card to give an agent time-boxed access."
            : `${activeCount} acting as you · ${passports.length} total`
      }
      action={
        <CreatePassportDialog>
          {({ openModal }) => (
            <Button size="sm" onClick={openModal}>
              <HugeiconsIcon
                icon={PlusSignIcon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              Create passport
            </Button>
          )}
        </CreatePassportDialog>
      }
    >
      <PassportsTable
        passports={passports}
        copiedValue={copiedValue}
        revokingId={revokingId}
        onCopy={(value) => void handleCopy(value)}
        onRevoke={(passportId) => void handleRevoke(passportId)}
      />
    </ContentCard>
  );
}
