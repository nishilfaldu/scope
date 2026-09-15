"use client";

import { Component, type ReactNode } from "react";
import { useQuery } from "convex/react";

import { NavUser } from "@/components/layout/nav-user";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { UserInfo } from "@/lib/user";

const FALLBACK_USER: UserInfo = {
  name: "Account",
  email: "",
};

function UserSkeleton() {
  return (
    <div className="flex items-center gap-2 p-2">
      <Skeleton className="size-8 rounded-lg" />
      <div className="grid flex-1 gap-1">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}

class UserErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <NavUser user={FALLBACK_USER} />;
    }
    return this.props.children;
  }
}

function SidebarUserInner() {
  const user = useQuery(api.users.viewer);
  if (user === undefined) {
    return <UserSkeleton />;
  }
  if (user === null) {
    return <NavUser user={FALLBACK_USER} />;
  }
  return <NavUser user={user} />;
}

export function SidebarUser() {
  return (
    <UserErrorBoundary>
      <SidebarUserInner />
    </UserErrorBoundary>
  );
}
