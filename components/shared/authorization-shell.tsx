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
    <main className="flex min-h-svh items-center bg-scope-wash px-4 py-8 text-scope-ink sm:py-12">
      <div className="mx-auto w-full max-w-xl">
        {showBrand ? (
          <div className="mb-6 flex items-center gap-2.5 px-1">
            <BrandMark priority className="size-8" />
            <span className="text-sm font-semibold tracking-tight">Scope</span>
          </div>
        ) : null}
        <section className="overflow-hidden rounded-2xl border border-scope-line bg-white">
          {children}
        </section>
      </div>
    </main>
  );
}
