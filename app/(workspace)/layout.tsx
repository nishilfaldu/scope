"use client";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BoardShell } from "@/components/layout/board-shell";
import {
  WorkspaceSkeleton,
  type BoardKind,
} from "@/components/layout/workspace-skeleton";
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const kind: BoardKind =
    path === "/agents"
      ? "agents"
      : path === "/connections"
        ? "connections"
        : path === "/notifications"
          ? "notifications"
          : "requests";
  const title = kind[0].toUpperCase() + kind.slice(1);
  return (
    <BoardShell>
      <Authenticated>{children}</Authenticated>
      <AuthLoading>
        <WorkspaceSkeleton title={title} kind={kind} />
      </AuthLoading>
      <Unauthenticated>
        <p role="alert">
          Your session could not be verified. Sign in again to continue.
        </p>
      </Unauthenticated>
    </BoardShell>
  );
}
