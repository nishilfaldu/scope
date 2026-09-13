"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FunctionReturnType } from "convex/server";

import type { api } from "@/convex/_generated/api";
import { CreatePassportDialog } from "@/components/passports/create-passport-dialog";
import { ContentCard } from "@/components/shared/content-card";
import { PassportsTable } from "@/components/passports/passports-table";
import { Button } from "@/components/ui/button";

type Passports = FunctionReturnType<typeof api.tables.passports.queries.list>;

export function PassportListCard({
  passports,
}: {
  passports: Passports | undefined;
}) {
  const activeCount = passports?.filter(
    (passport) => passport.lifetimeStatus === "active",
  ).length;

  return (
    <ContentCard
      title="Passports"
      description={
        passports === undefined
          ? "Loading cards…"
          : passports.length === 0
            ? "Create a card to give an agent time-boxed access."
            : `${activeCount} active · ${passports.length} total`
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
      <PassportsTable passports={passports} />
    </ContentCard>
  );
}
