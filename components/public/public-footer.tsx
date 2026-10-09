import Link from "next/link";

import { BrandMark } from "@/components/shared/brand-mark";

const linkClass =
  "rounded-md text-scope-quiet hover:text-scope-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30";

export function PublicFooter() {
  return (
    <footer className="border-t border-scope-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[minmax(0,1.4fr)_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5 font-semibold tracking-[-0.02em]">
            <BrandMark className="size-7" />
            Scope
          </div>
          <p className="mt-4 max-w-xs leading-6 text-scope-quiet">
            Rules, approvals and an activity log for the AI apps that use your
            accounts.
          </p>
        </div>
        <nav aria-label="Product">
          <h2 className="font-semibold">Product</h2>
          <ul className="mt-4 space-y-3">
            <li>
              <Link className={linkClass} href="/#how">
                How it works
              </Link>
            </li>
            <li>
              <Link className={linkClass} href="/#accounts">
                Accounts
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Legal">
          <h2 className="font-semibold">Legal</h2>
          <ul className="mt-4 space-y-3">
            <li>
              <Link className={linkClass} href="/privacy">
                Privacy policy
              </Link>
            </li>
            <li>
              <Link className={linkClass} href="/terms">
                Terms of service
              </Link>
            </li>
            <li>
              <a className={linkClass} href="mailto:nishilfaldu@gmail.com">
                Contact
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-scope-line">
        <p className="mx-auto max-w-6xl px-5 py-5 text-scope-quiet sm:px-8">
          © 2026 Scope
        </p>
      </div>
    </footer>
  );
}
