"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { ApprovalRequest } from "@/lib/approval-display";

type PendingRequests = { rows: ApprovalRequest[] | undefined };
const PendingRequestsContext = createContext<PendingRequests | null>(null);

export function PendingRequestsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const rows = useQuery(
    api.approvals.pendingForOwner,
    isAuthenticated ? {} : "skip",
  );

  return (
    <PendingRequestsContext value={{ rows }}>{children}</PendingRequestsContext>
  );
}

export function usePendingRequests() {
  const context = useContext(PendingRequestsContext);
  if (!context) throw new Error("PendingRequestsProvider is required.");
  return context;
}
