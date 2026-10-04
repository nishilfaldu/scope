"use client";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiChat02Icon,
  Plug01Icon,
  Notification01Icon,
  ShieldKeyIcon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePendingRequests } from "@/components/approvals/pending-requests-provider";
import { approvalStatus } from "@/lib/approval-display";
import styles from "@/components/scope/scope.module.css";
const navigation = [
  { label: "Requests", path: "/approvals", icon: ShieldKeyIcon },
  { label: "Connections", path: "/connections", icon: Plug01Icon },
  { label: "Agents", path: "/agents", icon: AiChat02Icon },
  { label: "Notifications", path: "/notifications", icon: Notification01Icon },
];
export function BoardShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { user, signOut } = useAuth();
  const { now, rows: pending } = usePendingRequests();
  const count =
    pending?.filter((r) => approvalStatus(r, now) === "Needs approval")
      .length ?? 0;
  return (
    <div className={styles.review}>
      <SidebarProvider
        className={styles.workspace}
        style={{ "--sidebar-width": "220px" } as CSSProperties}
      >
        <Sidebar collapsible="none" className={styles.rail}>
          <SidebarHeader className="p-0">
            <Link href="/approvals" className={styles.brand}>
              <BrandMark className="size-7" />
              <span>Scope</span>
            </Link>
          </SidebarHeader>
          <SidebarContent className={styles.sidebarContent}>
            <nav aria-label="Scope navigation">
              <SidebarMenu className={styles.navigation}>
                {navigation.map(({ label, path: href, icon }) => (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      render={
                        <Link
                          href={href}
                          aria-current={path === href ? "page" : undefined}
                        />
                      }
                      isActive={path === href}
                    >
                      <HugeiconsIcon icon={icon} size={20} strokeWidth={1.7} />
                      <span>{label}</span>
                      {href === "/approvals" && count > 0 && (
                        <span className={styles.navCount}>{count}</span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarContent>
          <SidebarFooter className={styles.accountMenu}>
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" className={styles.accountTrigger} />
                  }
                >
                  My account <HugeiconsIcon icon={ArrowDown01Icon} size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="end"
                  sideOffset={8}
                  className={styles.accountDropdown}
                >
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className={styles.accountEmail}>
                      {user.email}
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className={styles.accountItem}
                    onClick={() =>
                      void signOut({ returnTo: window.location.origin + "/" })
                    }
                  >
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Skeleton className="h-9 w-28 rounded-lg" />
            )}
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className={styles.main}>{children}</SidebarInset>
      </SidebarProvider>
    </div>
  );
}
