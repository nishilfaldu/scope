"use client";

import { useEffect, useState } from "react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { BoardShell } from "@/components/layout/board-shell";
import { ConnectionsTable } from "@/components/connections/connections-table";
import { ContentCard } from "@/components/shared/content-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CONNECT_ERRORS,
  ALL_APPS,
  type AppId,
} from "@/lib/connections";

function readOauthReturn(): { provider: AppId; message: string } | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  for (const id of ALL_APPS) {
    const value = url.searchParams.get(id);
    if (!value || value === "connected") continue;
    if (value === "denied") {
      return { provider: id, message: "Access was denied." };
    }
    const reason = url.searchParams.get("reason");
    return {
      provider: id,
      message:
        (reason && CONNECT_ERRORS[reason]) ||
        "Connect failed. Flip the toggle again.",
    };
  }
  return null;
}

export function ConnectionsBoard() {
  const [connectBanner] = useState(readOauthReturn);

  useEffect(() => {
    const url = new URL(window.location.href);
    let dirty = false;
    for (const id of ALL_APPS) {
      if (url.searchParams.has(id)) {
        url.searchParams.delete(id);
        dirty = true;
      }
    }
    if (url.searchParams.has("reason")) {
      url.searchParams.delete("reason");
      dirty = true;
    }
    if (!dirty) return;
    const search = url.searchParams.toString();
    window.history.replaceState(
      {},
      "",
      search.length > 0 ? `${url.pathname}?${search}` : url.pathname,
    );
  }, []);

  return (
    <BoardShell title="Connections">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        {connectBanner ? (
          <div className="px-4 lg:px-6">
            <Alert variant="destructive">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
              <AlertTitle>Connect failed</AlertTitle>
              <AlertDescription>{connectBanner.message}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="px-4 lg:px-6">
          <ContentCard
            title="Connections"
            description="Connect an account before adding its apps to a slice."
          >
            <ConnectionsTable />
          </ContentCard>
        </div>
      </div>
    </BoardShell>
  );
}
