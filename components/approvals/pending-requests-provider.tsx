"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type PendingRequests = { count: number | undefined };
const PendingRequestsContext = createContext<PendingRequests | null>(null);

export function PendingRequestsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const count = useQuery(
    api.access.pendingCount,
    isAuthenticated ? {} : "skip",
  );

  return (
    <PendingRequestsContext value={{ count }}>
      {children}
    </PendingRequestsContext>
  );
}

export function usePendingRequests() {
  const context = useContext(PendingRequestsContext);
  if (!context) throw new Error("PendingRequestsProvider is required.");
  return context;
}
