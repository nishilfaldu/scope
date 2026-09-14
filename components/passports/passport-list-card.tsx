"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { CreatePassportDialog } from "@/components/passports/create-passport-dialog";
import { ContentCard } from "@/components/shared/content-card";
import { PassportsTable } from "@/components/passports/passports-table";
import { Button } from "@/components/ui/button";

export function PassportListCard() {
  return (
    <CreatePassportDialog>
      {({ openModal }) => (
        <ContentCard
          title="Passports"
          description="Create a time-boxed identity for one job and choose which connected apps it can request."
          action={
            <Button size="sm" onClick={openModal}>
              <HugeiconsIcon
                icon={PlusSignIcon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              Create passport
            </Button>
          }
        >
          <PassportsTable onRequestCreate={openModal} />
        </ContentCard>
      )}
    </CreatePassportDialog>
  );
}
