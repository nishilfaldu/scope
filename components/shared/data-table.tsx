"use client";

import type { ReactNode } from "react";
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
  pagination,
}: {
  data: readonly T[] | undefined;
  columns: readonly DataTableColumn<T>[];
  getRowKey: (row: T) => string;
  loadingRowCount?: number;
  empty?: ReactNode;
  pagination?: ReactNode;
}) {
  const table = useTable({
    features,
    data: data ?? (EMPTY_DATA as T[]),
    columns,
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: 10_000,
      },
    },
  });

  const rows = table.getRowModel().rows;

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
      {pagination ? <div className="border-t">{pagination}</div> : null}
    </div>
  );
}
