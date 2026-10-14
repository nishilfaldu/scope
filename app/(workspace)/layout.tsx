"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import Link from "next/link";

import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { WorkspaceSkeleton } from "@/components/layout/workspace-skeleton";
import { Button } from "@/components/ui/button";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceShell>
      <Authenticated>{children}</Authenticated>
      <AuthLoading>
        <WorkspaceSkeleton />
      </AuthLoading>
      <Unauthenticated>
        <p className="mb-4 text-scope-quiet">
          Your session could not be verified. Sign in again to continue.
        </p>
        <Button render={<Link href="/signin" />}>Sign in</Button>
      </Unauthenticated>
    </WorkspaceShell>
  );
}
