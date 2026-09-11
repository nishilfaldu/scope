"use client";

import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "convex/react";

import { api } from "../convex/_generated/api";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader, type HeaderCrumb } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function BoardShell({
  title,
  crumbs,
  children,
}: {
  title: string;
  crumbs?: HeaderCrumb[];
  children: ReactNode;
}) {
  const statuses = useQuery(api.connections.listStatuses);
  const githubRow = statuses?.find((row) => row.provider === "github");
  const github =
    statuses === undefined
      ? undefined
      : githubRow?.connected === true
        ? { connected: true as const, login: githubRow.login ?? "" }
        : { connected: false as const };

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
        <SiteHeader title={title} crumbs={crumbs} />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
