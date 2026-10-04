"use client";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { usePathname } from "next/navigation";
import { BoardShell } from "@/components/layout/board-shell";
import { PendingRequestsProvider } from "@/components/approvals/pending-requests-provider";
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
    <PendingRequestsProvider>
      <BoardShell>
        <Authenticated>{children}</Authenticated>
        <AuthLoading>
          <WorkspaceSkeleton title={title} kind={kind} />
        </AuthLoading>
        <Unauthenticated>
          <SessionRecovery />
        </Unauthenticated>
      </BoardShell>
    </PendingRequestsProvider>
  );
}

function SessionRecovery() {
  useEffect(() => {
    toast.add({
      id: "session-verification",
      title: "Your session could not be verified. Sign in again to continue.",
      type: "error",
      priority: "high",
    });
  }, []);
  return <Button render={<Link href="/signin" />}>Sign in</Button>;
}
