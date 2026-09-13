import { ContentCard } from "@/components/shared/content-card";

export function PassportSummaryCard({
  activeCount,
}: {
  activeCount: number | undefined;
}) {
  return (
    <ContentCard
      size="sm"
      headerBorder={false}
      titleClassName="flex flex-col gap-1.5"
      title={
        <>
          <span className="font-sans text-sm font-normal text-muted-foreground">
            Active passports
          </span>
          <span className="text-2xl font-semibold tabular-nums">
            {activeCount === undefined ? "…" : activeCount}
          </span>
        </>
      }
    />
  );
}
