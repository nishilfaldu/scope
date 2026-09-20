import type { ReactNode } from "react";
import { BrandMark } from "@/components/shared/brand-mark";

export function AuthorizationShell({
  children,
  showBrand = true,
}: {
  children: ReactNode;
  showBrand?: boolean;
}) {
  return (
    <main className="flex min-h-svh items-center bg-[radial-gradient(circle_at_top,oklch(0.98_0.025_130),transparent_34rem)] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-xl">
        {showBrand ? (
          <div className="mb-6 flex items-center gap-2.5 px-1">
            <BrandMark
              priority
              className="size-8 shadow-sm shadow-primary/20"
            />
            <span className="text-sm font-semibold tracking-tight">Scope</span>
          </div>
        ) : null}
        <section className="overflow-hidden rounded-2xl border bg-card shadow-[0_18px_50px_-32px_rgba(15,23,42,0.45)]">
          {children}
        </section>
      </div>
    </main>
  );
}
