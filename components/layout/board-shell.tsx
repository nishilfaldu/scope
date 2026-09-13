"use client";

import type { CSSProperties, ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { SiteHeader, type HeaderCrumb } from "@/components/layout/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

const PLACEHOLDER_USER = {
  name: "Demo User",
  email: "demo@example.com",
};

export function BoardShell({
  title,
  crumbs,
  children,
}: {
  title: string;
  crumbs?: HeaderCrumb[];
  children: ReactNode;
}) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <AppSidebar variant="inset" user={PLACEHOLDER_USER} />
      <SidebarInset>
        <SiteHeader title={title} crumbs={crumbs} />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
