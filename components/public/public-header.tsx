import Link from "next/link";

import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";

const signIn = "/signin?redirectTo=/requests";

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-scope-line bg-scope-wash/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg text-base font-semibold tracking-[-0.02em] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          aria-label="Scope home"
        >
          <BrandMark priority className="size-7" />
          Scope
        </Link>
        <Button size="sm" nativeButton={false} render={<Link href={signIn} />}>
          Sign in
        </Button>
      </div>
    </header>
  );
}
