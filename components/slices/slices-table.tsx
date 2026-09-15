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

type Slice = FunctionReturnType<
  typeof api.tables.slices.queries.list
>["page"][number];

const PAGE_SIZE = 10;

export function SlicesTable() {
  const router = useRouter();
  const { paginationOpts, canPrevious, goNext, goPrevious } =
    useCursorPagination(PAGE_SIZE);
  const result = useQuery(api.tables.slices.queries.list, {
    paginationOpts,
  });
  const [revoke] = useErrorCatchingMutation(
    api.tables.slices.mutations.revoke,
    { successMessage: "Slice revoked" },
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

  const columns: DataTableColumn<Slice>[] = [
    {
      id: "name",
      header: "Name",
      cell: ({ row: { original: slice } }) => (
        <Link
          href={`/passports/${slice._id}`}
          className="font-medium hover:underline"
        >
          {slice.name}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row: { original: slice } }) => (
        <Badge
          variant={
            slice.status === "active"
              ? "secondary"
              : slice.status === "revoked"
                ? "destructive"
                : "outline"
          }
        >
          {STATUS_LABELS[slice.status]}
        </Badge>
      ),
    },
    {
      id: "apps",
      header: "Apps",
      cell: ({ row: { original: slice } }) => (
        <div className="flex flex-wrap gap-1">
          {slice.grantApps.map((app) => (
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
      cell: ({ row: { original: slice } }) => (
        <Badge variant="outline">
          {formatRemaining(slice.expiresAt, Date.now())}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: slice } }) => {
        const items: ActionsMenuItem[] = [
          {
            id: "view",
            label: "View",
            icon: File01Icon,
            onSelect: () => router.push(`/passports/${slice._id}`),
          },
          {
            id: "copy-token",
            label: "Copy slice token",
            icon: Copy01Icon,
            onSelect: () => void handleCopy("Slice token", slice.token),
          },
        ];
        if (slice.status === "active") {
          items.push({
            id: "revoke",
            label: revokingId === slice.token ? "Revoking…" : "Revoke",
            icon: Delete02Icon,
            variant: "destructive",
            disabled: revokingId === slice.token,
            separatorBefore: true,
            onSelect: () => void handleRevoke(slice.token),
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
      getRowKey={(slice) => slice._id}
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
          title="No slices"
          description="Create a slice for an agent."
          icon={<HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />}
        />
      }
    />
  );
}
