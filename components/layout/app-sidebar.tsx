"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AiChat02Icon,
  Plug01Icon,
  Notification01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { SidebarUser } from "@/components/layout/sidebar-user";
import { BrandMark } from "@/components/shared/brand-mark";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const NAV = [
  { title: "Approvals", href: "/approvals", icon: ShieldKeyIcon },
  { title: "Agents", href: "/agents", icon: AiChat02Icon },
  { title: "Connections", href: "/connections", icon: Plug01Icon },
  { title: "Notifications", href: "/notifications", icon: Notification01Icon },
] as const;

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/approvals" />}
              tooltip="Scope"
            >
              <BrandMark className="size-8" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Scope</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={
                      pathname === item.href ||
                      pathname.startsWith(`${item.href}/`) ||
                      (item.href === "/agents" &&
                        pathname.startsWith("/slices/"))
                    }
                    tooltip={item.title}
                    render={<Link href={item.href} />}
                  >
                    <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarUser />
      </SidebarFooter>
    </Sidebar>
  );
}
