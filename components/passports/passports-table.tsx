"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "convex/react";
import {
  Copy01Icon,
  Delete02Icon,
  File01Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import { CreatePassportDialog } from "@/components/passports/create-passport-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATUS_LABELS, lastEventLabel } from "@/lib/audit";
import {
  APP_LABELS,
  formatRelativeTime,
  formatRemaining,
} from "@/lib/capabilities";

type Passport = FunctionReturnType<typeof api.tables.passports.queries.list>[number];

export function PassportsTable({
  passports,
}: {
  passports: FunctionReturnType<typeof api.tables.passports.queries.list> | undefined;
}) {
  const router = useRouter();
  const revoke = useMutation(api.tables.passports.mutations.revoke);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleCopy(value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue(null), 1500);
  }

  async function handleRevoke(passportId: string) {
    setRevokingId(passportId);
    try {
      await revoke({ passportId });
    } finally {
      setRevokingId(null);
    }
  }

  const columns: DataTableColumn<Passport>[] = [
    {
      id: "name",
      header: "Name",
      cell: ({ row: { original: passport } }) => (
        <Link
          href={`/passports/${passport._id}`}
          className="font-medium hover:underline"
        >
          {passport.name}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row: { original: passport } }) => (
        <Badge
          variant={
            passport.lifetimeStatus === "active"
              ? "secondary"
              : passport.lifetimeStatus === "revoked"
                ? "destructive"
                : "outline"
          }
        >
          {STATUS_LABELS[passport.lifetimeStatus]}
        </Badge>
      ),
    },
    {
      id: "apps",
      header: "Apps",
      cell: ({ row: { original: passport } }) => (
        <div className="flex flex-wrap gap-1">
          {passport.apps.map((app) => (
            <Badge key={app} variant="secondary">
              {APP_LABELS[app]}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: "expires",
      header: "Expires",
      cell: ({ row: { original: passport } }) => (
        <Badge variant="outline">
          {formatRemaining(passport.expiresAt, Date.now())}
        </Badge>
      ),
    },
    {
      id: "last-event",
      header: "Last event",
      cell: ({ row: { original: passport } }) =>
        passport.lastEvent ? (
          <div className="min-w-0 max-w-56">
            <p
              className={
                passport.lastEvent.outcome === "allowed"
                  ? "truncate"
                  : "truncate text-destructive"
              }
            >
              {lastEventLabel(passport.lastEvent)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {formatRelativeTime(passport.lastEvent.occurredAt, Date.now())}
            </p>
          </div>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    {
      id: "passport-id",
      header: "Passport id",
      cell: ({ row: { original: passport } }) => (
        <div className="flex min-w-0 items-center gap-1">
          <code className="max-w-28 truncate font-mono text-xs">
            {passport.token}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => void handleCopy(passport.token)}
          >
            <HugeiconsIcon
              icon={copiedValue === passport.token ? Tick02Icon : Copy01Icon}
              strokeWidth={2}
            />
            <span className="sr-only">Copy token</span>
          </Button>
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: passport } }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
            <span className="sr-only">Open menu</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => router.push(`/passports/${passport._id}`)}
            >
              <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
              View history
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleCopy(passport.token)}>
              <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
              Copy token
            </DropdownMenuItem>
            {passport.lifetimeStatus === "active" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={revokingId === passport.token}
                  onClick={() => void handleRevoke(passport.token)}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  {revokingId === passport.token ? "Revoking…" : "Revoke"}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <DataTable
      data={passports}
      columns={columns}
      getRowKey={(passport) => passport._id}
      empty={
        <EmptyState
          title="No passports"
          description="Create a virtual card for a job. Agents receive a passport id and an invoke key—never standing account tokens."
          icon={<HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />}
          action={
            <CreatePassportDialog>
              {({ openModal }) => (
                <Button type="button" onClick={openModal}>
                  Create passport
                </Button>
              )}
            </CreatePassportDialog>
          }
        />
      }
    />
  );
}
