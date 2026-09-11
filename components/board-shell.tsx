"use client";

import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "convex/react";

import { api } from "../convex/_generated/api";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function BoardShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const github = useQuery(api.connections.status, { provider: "github" });

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <AppSidebar variant="inset" github={github} />
      <SidebarInset>
        <SiteHeader title={title} />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
