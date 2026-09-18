"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { CreateSliceDialog } from "@/components/slices/create-slice-dialog";
import { ContentCard } from "@/components/shared/content-card";
import { SlicesTable } from "@/components/slices/slices-table";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function SliceListCard() {
  return (
    <ContentCard
      title="Slices"
      description="Agents request access with an approval link. Review requests in Approvals; create a slice manually only when needed."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" render={<Link href="/approvals" />}>Review agent requests</Button>
          <CreateSliceDialog>
            {({ openModal }) => (
              <Button size="sm" variant="outline" onClick={openModal}>
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} data-icon="inline-start" />
                Create manually
              </Button>
            )}
          </CreateSliceDialog>
        </div>
      }
    >
      <SlicesTable />
    </ContentCard>
  );
}
