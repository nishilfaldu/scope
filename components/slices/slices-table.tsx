"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import { ConvexPagination } from "@/components/shared/convex-pagination";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ExpiryTime } from "@/components/shared/expiry-time";
import { Badge } from "@/components/ui/badge";
import { SliceRevokeButton } from "@/components/slices/slice-revoke-button";
import { useCursorPagination } from "@/hooks/use-cursor-pagination";
import { effectiveSliceStatus, STATUS_LABELS } from "@/lib/capabilities";
import { useNow } from "@/hooks/use-now";

type Slice = FunctionReturnType<
  typeof api.tables.slices.queries.list
>["page"][number];

const PAGE_SIZE = 10;

export function SlicesTable() {
  const now = useNow();
  const { paginationOpts, canPrevious, goNext, goPrevious } =
    useCursorPagination(PAGE_SIZE);
  const result = useQuery(api.tables.slices.queries.list, {
    paginationOpts,
  });
  const columns: DataTableColumn<Slice>[] = [
    {
      id: "name",
      header: "Name",
      cell: ({ row: { original: slice } }) => (
        <Link
          href={`/slices/${slice._id}`}
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
            effectiveSliceStatus(slice, now) === "active"
              ? "secondary"
              : effectiveSliceStatus(slice, now) === "revoked"
                ? "destructive"
                : "outline"
          }
        >
          {STATUS_LABELS[effectiveSliceStatus(slice, now)]}
        </Badge>
      ),
    },
    {
      id: "expires",
      header: "Expires",
      cell: ({ row: { original: slice } }) => (
        <ExpiryTime expiresAt={slice.expiresAt} now={now} stacked />
      ),
    },
    {
      id: "revoke",
      header: "Revoke",
      cell: ({ row: { original: slice } }) =>
        effectiveSliceStatus(slice, now) === "active" ? (
          <SliceRevokeButton sliceToken={slice.token} sliceName={slice.name} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
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
          icon={<HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />}
        />
      }
    />
  );
}
