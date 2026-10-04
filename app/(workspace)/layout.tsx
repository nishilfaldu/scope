"use client";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import type { ReactNode } from "react";
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Authenticated>{children}</Authenticated>
      <AuthLoading>
        <p className="p-8">Loading Scope…</p>
      </AuthLoading>
      <Unauthenticated>
        <p className="p-8">
          Your session could not be verified. Sign in again to continue.
        </p>
      </Unauthenticated>
    </>
  );
}
