import type { ReactNode } from "react";
import { SecurityCheckIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BrandMark } from "@/components/shared/brand-mark";

export function AuthorizationShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-svh bg-[radial-gradient(circle_at_top,oklch(0.98_0.025_130),transparent_34rem)] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <BrandMark
              priority
              className="size-8 shadow-sm shadow-primary/20"
            />
            <span className="text-sm font-semibold tracking-tight">Scope</span>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HugeiconsIcon
              icon={SecurityCheckIcon}
              className="size-3.5"
              strokeWidth={2}
            />
            Secure approval
          </span>
        </div>
        <section className="overflow-hidden rounded-2xl border bg-card shadow-[0_18px_50px_-32px_rgba(15,23,42,0.45)]">
          {children}
        </section>
      </div>
    </main>
  );
}
