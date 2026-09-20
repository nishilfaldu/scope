"use client";

import { useEffect } from "react";
import Link from "next/link";

import { BoardShell } from "@/components/layout/board-shell";
import { ConnectionsTable } from "@/components/connections/connections-table";
import { toast } from "@/components/ui/toast";
import { CONNECT_ERRORS, ALL_APPS } from "@/lib/connections";

function readOauthError(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  for (const id of ALL_APPS) {
    const value = url.searchParams.get(id);
    if (!value || value === "connected") continue;
    if (value === "denied") {
      return "Access was denied.";
    }
    const reason = url.searchParams.get("reason");
    return (
      (reason && CONNECT_ERRORS[reason]) ||
      "Connect failed. Try connecting again."
    );
  }
  return null;
}

export function ConnectionsBoard({ returnTo }: { returnTo: string | null }) {
  useEffect(() => {
    const connectError = readOauthError();
    if (connectError) {
      toast.add({
        title: "Connect failed",
        description: connectError,
        type: "error",
      });
    }
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
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 lg:px-8 lg:py-10">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Connections
            </h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Accounts available when you approve agent access.
            </p>
          </div>
          {returnTo ? (
            <div className="text-sm">
              <Link
                className="font-medium underline underline-offset-4"
                href={returnTo}
              >
                Return to request
              </Link>
            </div>
          ) : null}
        </div>
        <div className="mt-8 overflow-hidden rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Apps and accounts</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect more than one account when you need separate identities.
            </p>
          </div>
          <ConnectionsTable />
        </div>
      </div>
    </BoardShell>
  );
}
