import { Skeleton } from "@/components/ui/skeleton";
export type BoardKind = "requests" | "connections" | "agents" | "notifications";
export function BoardSkeleton({ kind = "requests" }: { kind?: BoardKind }) {
  return (
    <div role="status" aria-label={`Loading ${kind}`} aria-busy="true">
      <span className="sr-only">Loading {kind}</span>
      <div aria-hidden="true">
        {kind === "notifications" ? (
          <div className="space-y-6 py-1">
            <Skeleton className="h-40 w-56 rounded-t-3xl rounded-b-none" />
            <Skeleton className="h-9 w-40 rounded-lg" />
          </div>
        ) : (
          <div className="divide-y divide-[#e3e9e3]">
            {Array.from({ length: kind === "requests" ? 3 : 2 }, (_, i) => (
              <div key={i} className="flex gap-4 p-6">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-3 py-1">
                  <Skeleton className="h-4 w-2/5 max-w-64 rounded-md" />
                  <Skeleton className="h-3 w-3/5 max-w-80 rounded-md" />
                  {kind === "requests" && (
                    <Skeleton className="mt-5 h-3 w-4/5 rounded-md" />
                  )}
                </div>
                <Skeleton className="h-7 w-16 shrink-0 rounded-lg" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
export function WorkspaceSkeleton({
  kind = "requests",
  title,
}: {
  kind?: BoardKind;
  title: string;
}) {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-[28px] font-medium tracking-[-1px]">{title}</h1>
        {kind !== "notifications" && (
          <Skeleton className="mt-3 h-4 w-60 rounded-md" />
        )}
      </header>
      <div
        className={
          kind === "notifications"
            ? ""
            : "overflow-hidden rounded-2xl border border-[#e3e9e3] bg-white"
        }
      >
        <BoardSkeleton kind={kind} />
      </div>
    </>
  );
}
