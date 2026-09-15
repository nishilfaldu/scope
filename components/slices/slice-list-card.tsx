"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { CreateSliceDialog } from "@/components/slices/create-slice-dialog";
import { ContentCard } from "@/components/shared/content-card";
import { SlicesTable } from "@/components/slices/slices-table";
import { Button } from "@/components/ui/button";

export function SliceListCard() {
  return (
    <ContentCard
      title="Slices"
      description="Create one time-boxed identity per agent. Its grant controls which connected apps it can request."
      action={
        <CreateSliceDialog>
          {({ openModal }) => (
            <Button size="sm" onClick={openModal}>
              <HugeiconsIcon
                icon={PlusSignIcon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              Create slice
            </Button>
          )}
        </CreateSliceDialog>
      }
    >
      <SlicesTable />
    </ContentCard>
  );
}
