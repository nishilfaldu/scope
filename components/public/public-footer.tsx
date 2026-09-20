import Link from "next/link";

import { BrandMark } from "@/components/shared/brand-mark";

export function PublicFooter() {
  return (
    <footer className="border-t border-[#dde5da] bg-white dark:border-border dark:bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-7" />
          <span className="font-medium">Scope Identity</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[#5d695f] dark:text-muted-foreground">
          <Link className="hover:text-foreground" href="/privacy">
            Privacy policy
          </Link>
          <a
            className="hover:text-foreground"
            href="mailto:nishilfaldu@gmail.com"
          >
            Contact
          </a>
          <span>© 2026 Scope Identity</span>
        </div>
      </div>
    </footer>
  );
}
