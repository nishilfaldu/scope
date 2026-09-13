import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

export function DataTableSkeletonRows({
  rowCount,
  columnCount,
}: {
  rowCount: number;
  columnCount: number;
}) {
  return Array.from({ length: rowCount }, (_, rowIndex) => (
    <TableRow key={rowIndex}>
      {Array.from({ length: columnCount }, (_, columnIndex) => (
        <TableCell key={columnIndex}>
          <Skeleton className="h-5 w-full max-w-32" />
        </TableCell>
      ))}
    </TableRow>
  ));
}
