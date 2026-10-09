import type { ReactNode } from "react";

import { PublicFooter } from "@/components/public/public-footer";
import { PublicHeader } from "@/components/public/public-header";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-scope-wash text-sm text-scope-ink">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <PublicHeader />
      {children}
      <PublicFooter />
    </div>
  );
}
