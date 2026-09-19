import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="min-h-svh bg-background p-6">
      <div className="mx-auto max-w-6xl space-y-7">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </main>
  );
}
