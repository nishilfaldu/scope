"use client";

import { usePaginatedQuery } from "convex/react";
import { UnavailableIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "../convex/_generated/api";
import { LoadMoreRow } from "@/components/load-more-row";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TOKEN_LOG_LABELS, formatWhen } from "@/lib/audit";
import { appLabel } from "@/lib/capabilities";

export function PassportTokenLog({ passportId }: { passportId: string }) {
  const tokenLogs = usePaginatedQuery(
    api.tokens.listLogs,
    { passportId },
    { initialNumItems: 50 },
  );

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Token log</CardTitle>
          <CardDescription>
            Issued, refreshed, revoked, and mint denied — passport, platform,
            reason, time. Raw tokens are never stored here.
          </CardDescription>
        </CardHeader>
        {tokenLogs.status === "LoadingFirstPage" ? (
          <div className="flex flex-col gap-3 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : tokenLogs.results.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={UnavailableIcon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>No token events</EmptyTitle>
              <EmptyDescription>
                When an agent requests credentials, every issue, refresh,
                revoke, and denial lands here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokenLogs.results.map((event) => (
                  <TableRow key={event._id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatWhen(event.occurredAt)}
                    </TableCell>
                    <TableCell>{TOKEN_LOG_LABELS[event.kind]}</TableCell>
                    <TableCell>{appLabel(event.platform)}</TableCell>
                    <TableCell className="max-w-72 text-sm">
                      {event.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <LoadMoreRow
              status={tokenLogs.status}
              onLoadMore={() => tokenLogs.loadMore(50)}
            />
          </>
        )}
      </Card>
    </div>
  );
}
