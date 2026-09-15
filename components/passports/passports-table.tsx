"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "convex/react";
import {
  Copy01Icon,
  Delete02Icon,
  File01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import {
  ActionsMenu,
  type ActionsMenuItem,
} from "@/components/shared/actions-menu";
import { ConvexPagination } from "@/components/shared/convex-pagination";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { useCursorPagination } from "@/hooks/use-cursor-pagination";
import { APP_LABELS, formatRemaining, STATUS_LABELS } from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

type Passport = FunctionReturnType<
  typeof api.tables.slices.queries.list
>["page"][number];

const PAGE_SIZE = 10;

export function PassportsTable() {
  const router = useRouter();
  const { paginationOpts, canPrevious, goNext, goPrevious } =
    useCursorPagination(PAGE_SIZE);
  const result = useQuery(api.tables.slices.queries.list, {
    paginationOpts,
  });
  const [revoke] = useErrorCatchingMutation(
    api.tables.slices.mutations.revoke,
    { successMessage: "Passport revoked" },
  );
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleCopy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.add({ title: `${label} copied`, type: "success" });
    } catch {
      toast.add({
        title: `Could not copy ${label.toLowerCase()}`,
        type: "error",
      });
    }
  }

  async function handleRevoke(passportToken: string) {
    setRevokingId(passportToken);
    try {
      await revoke({ passportToken });
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
            label: "View",
            icon: File01Icon,
            onSelect: () => router.push(`/passports/${passport._id}`),
          },
          {
            id: "copy-token",
            label: "Copy passport token",
            icon: Copy01Icon,
            onSelect: () => void handleCopy("Passport token", passport.token),
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

  const canNext = result !== undefined && !result.isDone;
  const showPagination = canPrevious || canNext;

  return (
    <DataTable
      data={result === undefined ? undefined : result.page}
      columns={columns}
      getRowKey={(passport) => passport._id}
      pagination={
        showPagination ? (
          <ConvexPagination
            canPrevious={canPrevious}
            canNext={canNext}
            onPrevious={goPrevious}
            onNext={() => {
              if (result && !result.isDone) {
                goNext(result.continueCursor);
              }
            }}
          />
        ) : undefined
      }
      empty={
        <EmptyState
          title="No passports"
          description="Create a virtual passport for an agent."
          icon={<HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />}
        />
      }
    />
  );
}
