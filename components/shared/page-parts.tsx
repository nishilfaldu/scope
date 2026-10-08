import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <h1 className="text-[28px] leading-tight font-[550] tracking-[-1px]">
        {title}
      </h1>
      {children && (
        <p className="mt-2 leading-relaxed text-scope-quiet">{children}</p>
      )}
    </header>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mb-10", className)} aria-label={title}>
      {(title || action) && (
        <div className="mb-3 flex items-center gap-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          <div className="ml-auto">{action}</div>
        </div>
      )}
      <div className="divide-y divide-scope-line overflow-hidden rounded-2xl border border-scope-line bg-white">
        {children}
      </div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-7 leading-relaxed text-scope-quiet">{children}</p>;
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
