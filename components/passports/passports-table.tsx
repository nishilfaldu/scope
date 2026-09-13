"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "convex/react";
import {
  Copy01Icon,
  Delete02Icon,
  File01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { CreatePassportDialog } from "@/components/passports/create-passport-dialog";
import {
  ActionsMenu,
  type ActionsMenuItem,
} from "@/components/shared/actions-menu";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_LABELS } from "@/lib/audit";
import { APP_LABELS, formatRemaining } from "@/lib/capabilities";

type Passport = FunctionReturnType<typeof api.tables.passports.queries.list>[number];

export function PassportsTable({
  passports,
}: {
  passports: FunctionReturnType<typeof api.tables.passports.queries.list> | undefined;
}) {
  const router = useRouter();
  const revoke = useMutation(api.tables.passports.mutations.revoke);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleCopy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  }

  async function handleRevoke(passportToken: string) {
    setRevokingId(passportToken);
    try {
      await revoke({ passportId: passportToken });
      toast.success("Passport revoked");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not revoke passport",
      );
    } finally {
      setRevokingId(null);
    }
  }

  const columns: DataTableColumn<Passport>[] = [
    {
      id: "name",
      header: "Name",
      cell: ({ row: { original: passport } }) => (
        <Link
          href={`/passports/${passport._id}`}
          className="font-medium hover:underline"
        >
          {passport.name}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row: { original: passport } }) => (
        <Badge
          variant={
            passport.status === "active"
              ? "secondary"
              : passport.status === "revoked"
                ? "destructive"
                : "outline"
          }
        >
          {STATUS_LABELS[passport.status]}
        </Badge>
      ),
    },
    {
      id: "apps",
      header: "Apps",
      cell: ({ row: { original: passport } }) => (
        <div className="flex flex-wrap gap-1">
          {passport.apps.map((app) => (
            <Badge key={app} variant="secondary">
              {APP_LABELS[app]}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: "expires",
      header: "Expires",
      cell: ({ row: { original: passport } }) => (
        <Badge variant="outline">
          {formatRemaining(passport.expiresAt, Date.now())}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: passport } }) => {
        const items: ActionsMenuItem[] = [
          {
            id: "view",
            label: "View history",
            icon: File01Icon,
            onSelect: () => router.push(`/passports/${passport._id}`),
          },
          {
            id: "copy-id",
            label: "Copy passport id",
            icon: Copy01Icon,
            onSelect: () => void handleCopy("Passport id", passport._id),
          },
          {
            id: "copy-token",
            label: "Copy token",
            icon: Copy01Icon,
            onSelect: () => void handleCopy("Token", passport.token),
          },
        ];
        if (passport.status === "active") {
          items.push({
            id: "revoke",
            label: revokingId === passport.token ? "Revoking…" : "Revoke",
            icon: Delete02Icon,
            variant: "destructive",
            disabled: revokingId === passport.token,
            separatorBefore: true,
            onSelect: () => void handleRevoke(passport.token),
          });
        }
        return <ActionsMenu items={items} />;
      },
    },
  ];

  return (
    <DataTable
      data={passports}
      columns={columns}
      getRowKey={(passport) => passport._id}
      pageSize={10}
      empty={
        <EmptyState
          title="No passports"
          description="Create a virtual card for a job. Agents receive a passport id and an invoke key—never standing account tokens."
          icon={<HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />}
          action={
            <CreatePassportDialog>
              {({ openModal }) => (
                <Button type="button" onClick={openModal}>
                  Create passport
                </Button>
              )}
            </CreatePassportDialog>
          }
        />
      }
    />
  );
}
