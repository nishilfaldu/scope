import { Skeleton } from "@/components/ui/skeleton";

export function ListSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="flex gap-4 p-6">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-3 py-1">
            <Skeleton className="h-4 w-2/5 max-w-64 rounded-md" />
            <Skeleton className="h-3 w-3/5 max-w-80 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkspaceSkeleton() {
  return (
    <>
      <Skeleton className="mb-3 h-8 w-40 rounded-md" />
      <Skeleton className="mb-8 h-4 w-60 rounded-md" />
      <div className="overflow-hidden rounded-2xl border border-scope-line bg-white">
        <ListSkeleton />
      </div>
    </>
  );
}
