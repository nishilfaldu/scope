"use client";

import type { ReactNode } from "react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";

import { DataTableSkeletonRows } from "@/components/shared/data-table-skeleton-rows";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const EMPTY_DATA: never[] = [];

export type DataTableColumn<T extends RowData> = ColumnDef<
  typeof features,
  T,
  unknown
>;

export function DataTable<T extends RowData>({
  data,
  columns,
  getRowKey,
  loadingRowCount = 3,
  empty,
  pageSize,
}: {
  data: readonly T[] | undefined;
  columns: readonly DataTableColumn<T>[];
  getRowKey: (row: T) => string;
  loadingRowCount?: number;
  empty?: ReactNode;
  /** When set, enables client-side pagination controls for this table. */
  pageSize?: number;
}) {
  const paginate = pageSize !== undefined;
  const table = useTable({
    features,
    data: data ?? (EMPTY_DATA as T[]),
    columns,
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: pageSize ?? 10_000,
      },
    },
  });

  const rows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const pagination = table.getState().pagination;
  const showPagination =
    paginate && data !== undefined && data.length > 0 && pageCount > 1;

  return (
    <div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {data === undefined ? (
            <DataTableSkeletonRows
              rowCount={loadingRowCount}
              columnCount={columns.length}
            />
          ) : data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="p-0">
                {empty ?? <EmptyState />}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={getRowKey(row.original)}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {showPagination ? (
        <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Page {pagination.pageIndex + 1} of {pageCount}
            <span className="mx-1.5 text-border">·</span>
            {data!.length} total
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              <HugeiconsIcon
                icon={ArrowLeft01Icon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                data-icon="inline-end"
              />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
