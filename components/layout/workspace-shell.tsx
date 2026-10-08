"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Activity01Icon,
  DashboardSquare01Icon,
  Notification01Icon,
  Plug01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Requests", path: "/requests", icon: ShieldKeyIcon },
  { label: "Apps", path: "/apps", icon: DashboardSquare01Icon },
  { label: "Activity", path: "/activity", icon: Activity01Icon },
  { label: "Accounts", path: "/accounts", icon: Plug01Icon },
  { label: "Notifications", path: "/notifications", icon: Notification01Icon },
];

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { user, signOut } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const pending = useQuery(
    api.approvals.pendingCount,
    isAuthenticated ? {} : "skip",
  );
  return (
    <div className="min-h-svh bg-scope-wash text-sm text-scope-ink">
      <div className="mx-auto flex min-h-svh max-w-[1440px] flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col border-scope-line px-5 py-5 md:sticky md:top-0 md:h-svh md:w-[220px] md:border-r md:py-9">
          <Link
            href="/requests"
            className="flex items-center gap-2.5 pl-3 text-xl font-semibold tracking-[-0.6px]"
          >
            <BrandMark className="size-7" />
            Scope
          </Link>
          <nav
            aria-label="Scope navigation"
            className="mt-4 flex gap-1 overflow-x-auto md:mt-12 md:flex-col"
          >
            {navigation.map(({ label, path: href, icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap hover:bg-scope-hover",
                  path === href && "bg-scope-hover font-medium",
                )}
              >
                <HugeiconsIcon icon={icon} size={20} strokeWidth={1.7} />
                {label}
                {href === "/requests" && !!pending && (
                  <span className="ml-auto text-xs text-scope-green">
                    {pending}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          {user && (
            <div className="mt-auto hidden pt-6 md:block">
              <p className="truncate px-3 text-xs text-scope-quiet">
                {user.email}
              </p>
              <Button
                variant="ghost"
                className="mt-1 w-full justify-start rounded-lg text-scope-quiet"
                onClick={() =>
                  void signOut({ returnTo: window.location.origin + "/" })
                }
              >
                Sign out
              </Button>
            </div>
          )}
        </aside>
        <main className="w-full min-w-0 px-5 pt-4 pb-12 md:mx-auto md:max-w-[980px] md:px-16 md:pt-14">
          {children}
        </main>
      </div>
    </div>
  );
}
