"use client";

import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { UnavailableIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "../convex/_generated/api";
import {
  AUDIT_KINDS,
  ACTOR_TYPES,
  OUTCOMES,
  type ActorType,
  type AuditKind,
  type Outcome,
} from "../convex/auditFields";
import { LoadMoreRow } from "@/components/load-more-row";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ACTOR_TYPE_LABELS,
  KIND_LABELS,
  OUTCOME_LABELS,
  formatActor,
  formatWhen,
} from "@/lib/audit";

const KIND_ITEMS = [
  { value: "all", label: "All events" },
  ...AUDIT_KINDS.map((kind) => ({
    value: kind,
    label: KIND_LABELS[kind],
  })),
];

const OUTCOME_ITEMS = [
  { value: "all", label: "All outcomes" },
  ...OUTCOMES.map((outcome) => ({
    value: outcome,
    label: OUTCOME_LABELS[outcome],
  })),
];

const ACTOR_ITEMS = [
  { value: "all", label: "All actors" },
  ...ACTOR_TYPES.map((actorType) => ({
    value: actorType,
    label: ACTOR_TYPE_LABELS[actorType],
  })),
];

export function PassportHistory({ passportId }: { passportId: string }) {
  const [kind, setKind] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [actorType, setActorType] = useState("all");
  const history = usePaginatedQuery(
    api.audit.listHistory,
    {
      passportId,
      kind: kind === "all" ? undefined : (kind as AuditKind),
      outcome: outcome === "all" ? undefined : (outcome as Outcome),
      actorType: actorType === "all" ? undefined : (actorType as ActorType),
    },
    { initialNumItems: 50 },
  );

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>History</CardTitle>
          <CardDescription>
            Issued, platform toggled, revoked, and expired — plus invoke
            presented / verified / used. Who, scopes, outcome, and why.
          </CardDescription>
          <CardAction className="flex flex-wrap gap-2">
            <Select
              items={KIND_ITEMS}
              value={kind}
              onValueChange={(value) => {
                if (value != null) setKind(value);
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter by event">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={OUTCOME_ITEMS}
              value={outcome}
              onValueChange={(value) => {
                if (value != null) setOutcome(value);
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter by outcome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTCOME_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={ACTOR_ITEMS}
              value={actorType}
              onValueChange={(value) => {
                if (value != null) setActorType(value);
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter by actor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTOR_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardAction>
        </CardHeader>
        {history.status === "LoadingFirstPage" ? (
          <div className="flex flex-col gap-3 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : history.results.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={UnavailableIcon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>No matching events</EmptyTitle>
              <EmptyDescription>
                Nothing in this passport’s trail matches the current filters.
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
                  <TableHead>Who</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.results.map((event) => (
                  <TableRow key={event._id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatWhen(event.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="font-medium">{KIND_LABELS[event.kind]}</p>
                        {event.action ? (
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {event.action}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatActor(event.actorType, event.actorId)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {event.scopes.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          event.scopes.map((scope) => (
                            <Badge key={scope} variant="outline">
                              {scope}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          event.outcome === "allowed" ? "secondary" : "destructive"
                        }
                      >
                        {OUTCOME_LABELS[event.outcome]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <p className="text-sm">{event.reason}</p>
                      {event.argsPreview ? (
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {event.argsPreview}
                        </p>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <LoadMoreRow
              status={history.status}
              onLoadMore={() => history.loadMore(50)}
            />
          </>
        )}
      </Card>
    </div>
  );
}
