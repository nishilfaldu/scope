import type { ReactNode } from "react";

export function DecisionHeader({
  title,
  subtitle,
  leading,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b px-6 py-5 sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <span
        className="size-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_0_5px_color-mix(in_oklch,var(--primary)_16%,transparent)]"
        aria-hidden="true"
      />
    </div>
  );
}

export function DecisionFacts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 text-sm">
      {children}
    </dl>
  );
}

export function DecisionFact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
