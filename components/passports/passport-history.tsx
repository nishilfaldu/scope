"use client";

import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { UnavailableIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  AUDIT_KINDS,
  ACTOR_TYPES,
  OUTCOMES,
  type ActorType,
  type AuditKind,
  type Outcome,
} from "@/convex/tables/auditEvents/fields";
import { ContentCard } from "@/components/shared/content-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect } from "@/components/shared/filter-select";
import { LoadMoreRow } from "@/components/shared/load-more-row";
import { Badge } from "@/components/ui/badge";
import {
  ACTOR_TYPE_LABELS,
  KIND_LABELS,
  OUTCOME_LABELS,
  formatActor,
  formatWhen,
  kindLabel,
} from "@/lib/audit";

const KIND_ITEMS = [
  { value: "all", label: "All events" },
  ...AUDIT_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
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
    api.tables.auditEvents.queries.listHistory,
    {
      passportId,
      kind: kind === "all" ? undefined : (kind as AuditKind),
      outcome: outcome === "all" ? undefined : (outcome as Outcome),
      actorType: actorType === "all" ? undefined : (actorType as ActorType),
    },
    { initialNumItems: 50 },
  );
  const columns: DataTableColumn<Doc<"auditEvents">>[] = [
    {
      id: "when",
      header: "When",
      cell: ({ row: { original: event } }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatWhen(event.occurredAt)}
        </span>
      ),
    },
    {
      id: "event",
      header: "Event",
      cell: ({ row: { original: event } }) => (
        <div className="min-w-0">
          <p className="font-medium">{kindLabel(event.kind)}</p>
          {event.action ? (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {event.action}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "actor",
      header: "Who",
      cell: ({ row: { original: event } }) => (
        <span className="text-sm">
          {formatActor(event.actorType, event.actorId)}
        </span>
      ),
    },
    {
      id: "scopes",
      header: "Scopes",
      cell: ({ row: { original: event } }) => (
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
      ),
    },
    {
      id: "outcome",
      header: "Outcome",
      cell: ({ row: { original: event } }) => (
        <Badge variant={event.outcome === "allowed" ? "secondary" : "destructive"}>
          {OUTCOME_LABELS[event.outcome]}
        </Badge>
      ),
    },
    {
      id: "reason",
      header: "Why",
      cell: ({ row: { original: event } }) => (
        <div className="max-w-72">
          <p className="text-sm">{event.reason}</p>
          {event.argsPreview ? (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {event.argsPreview}
            </p>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <ContentCard
      title="History"
      description="Everything that touched this passport, including credential issue, refresh, revoke, and deny. Who, scopes, outcome, and why."
      action={
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            label="Filter by event"
            items={KIND_ITEMS}
            value={kind}
            onChange={setKind}
          />
          <FilterSelect
            label="Filter by outcome"
            items={OUTCOME_ITEMS}
            value={outcome}
            onChange={setOutcome}
          />
          <FilterSelect
            label="Filter by actor"
            items={ACTOR_ITEMS}
            value={actorType}
            onChange={setActorType}
          />
        </div>
      }
    >
      <DataTable
        data={history.status === "LoadingFirstPage" ? undefined : history.results}
        columns={columns}
        getRowKey={(event) => event._id}
        empty={
          <EmptyState
            title="No matching events"
            description="Nothing in this passport’s trail matches the current filters."
            icon={<HugeiconsIcon icon={UnavailableIcon} strokeWidth={2} />}
          />
        }
      />
      <LoadMoreRow
        status={history.status}
        onLoadMore={() => history.loadMore(50)}
      />
    </ContentCard>
  );
}
