"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { api } from "@/convex/_generated/api";
import { useNow } from "@/hooks/use-now";
import type { ApprovalRequest } from "@/lib/approval-display";

type PendingRequests = { now: number; rows: ApprovalRequest[] | undefined };
const PendingRequestsContext = createContext<PendingRequests | null>(null);

export function PendingRequestsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const ownerId = isAuthenticated ? user?.id : undefined;
  const now = useNow();
  const result = useQuery(
    api.approvals.pendingForOwner,
    ownerId ? { now } : "skip",
  );
  const [previous, setPrevious] = useState<{
    ownerId: string | undefined;
    rows: ApprovalRequest[] | undefined;
  }>({ ownerId, rows: undefined });

  // Changing the time argument briefly returns undefined. Keep the current
  // owner's rows mounted during that refresh, but clear them on session changes.
  if (
    previous.ownerId !== ownerId ||
    (result !== undefined && result !== previous.rows)
  )
    setPrevious({ ownerId, rows: result });
  const rows =
    result ?? (previous.ownerId === ownerId ? previous.rows : undefined);

  return (
    <PendingRequestsContext value={{ now, rows }}>
      {children}
    </PendingRequestsContext>
  );
}

export function usePendingRequests() {
  const context = useContext(PendingRequestsContext);
  if (!context) throw new Error("PendingRequestsProvider is required.");
  return context;
}
