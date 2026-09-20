import Link from "next/link";

import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";

export function PublicHeader() {
  return (
    <header className="border-b border-[#dde5da] bg-[#f7f9f5]/90 dark:border-border dark:bg-background/90">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          aria-label="Scope Identity home"
        >
          <BrandMark priority className="size-8" />
          <span className="font-semibold tracking-[-0.02em]">Scope</span>
        </Link>
        <nav
          className="flex items-center gap-2"
          aria-label="Primary navigation"
        >
          <Link
            href="/privacy"
            className="hidden rounded-md px-3 py-2 text-sm text-[#526054] hover:text-[#172019] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 sm:block dark:text-muted-foreground dark:hover:text-foreground"
          >
            Privacy
          </Link>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/signin" />}
          >
            Sign in
          </Button>
        </nav>
      </div>
    </header>
  );
}
