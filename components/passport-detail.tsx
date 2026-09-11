"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import {
  Copy01Icon,
  Delete02Icon,
  PassportIcon,
  Tick02Icon,
  UnavailableIcon,
} from "@hugeicons/core-free-icons";
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
import { BoardShell } from "@/components/board-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  STATUS_LABELS,
  formatActor,
  formatWhen,
} from "@/lib/audit";
import { APP_LABELS, formatRemaining } from "@/lib/capabilities";

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

export function PassportDetail({ passportId }: { passportId: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [kind, setKind] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [actorType, setActorType] = useState("all");
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const passport = useQuery(api.passports.get, { passportId, now });
  const chain = useQuery(api.audit.chainStatus, { passportId });
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
  const revoke = useMutation(api.passports.revoke);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function handleRevoke(token: string) {
    setRevoking(true);
    try {
      await revoke({ passportId: token });
      setNow(Date.now());
    } finally {
      setRevoking(false);
    }
  }

  if (passport === undefined) {
    return (
      <BoardShell title="Passport" crumbs={[{ label: "Passports", href: "/" }]}>
        <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="flex flex-col gap-3 px-4 lg:px-6">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </BoardShell>
    );
  }

  if (passport === null) {
    return (
      <BoardShell title="Not found" crumbs={[{ label: "Passports", href: "/" }]}>
        <div className="@container/main flex flex-1 flex-col py-4 md:py-6">
          <div className="px-4 lg:px-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={PassportIcon} strokeWidth={2} />
                </EmptyMedia>
                <EmptyTitle>Passport not found</EmptyTitle>
                <EmptyDescription>
                  This card may have been deleted from the deployment, or the
                  link is invalid.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        </div>
      </BoardShell>
    );
  }

  return (
    <BoardShell
      title={passport.name}
      crumbs={[{ label: "Passports", href: "/" }]}
    >
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>{passport.name}</CardTitle>
              <CardDescription>
                Complete history of everything that touched this passport.
                Events cannot be edited or deleted.
              </CardDescription>
              <CardAction className="flex flex-wrap items-center gap-2">
                {passport.lifetimeStatus === "active" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoking}
                    onClick={() => void handleRevoke(passport.token)}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      strokeWidth={2}
                      data-icon="inline-start"
                    />
                    {revoking ? "Revoking…" : "Revoke"}
                  </Button>
                ) : null}
              </CardAction>
            </CardHeader>
            <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge
                  className="mt-1"
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
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Apps</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {passport.apps.map((app) => (
                    <Badge key={app} variant="secondary">
                      {APP_LABELS[app]}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expires</p>
                <p className="mt-1 text-sm">
                  {formatRemaining(passport.expiresAt, now)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Passport</p>
                <div className="mt-1 flex min-w-0 items-center gap-1">
                  <code className="max-w-36 truncate font-mono text-xs">
                    {passport.token}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void copyToken(passport.token)}
                  >
                    <HugeiconsIcon
                      icon={copied ? Tick02Icon : Copy01Icon}
                      strokeWidth={2}
                    />
                    <span className="sr-only">Copy token</span>
                  </Button>
                </div>
              </div>
            </div>
            {chain ? (
              <div className="border-t px-6 py-3 text-sm">
                {chain.eventCount === 0 ? (
                  <p className="text-muted-foreground">
                    No chained events yet. Older invoke rows appear below until
                    the next write.
                  </p>
                ) : chain.intact ? (
                  <p>
                    Audit chain intact · {chain.eventCount} event
                    {chain.eventCount === 1 ? "" : "s"}. Records are append-only.
                  </p>
                ) : (
                  <p className="text-destructive">
                    Audit chain broken · expected seq {chain.expectedSeq}, found{" "}
                    {chain.eventCount}.
                  </p>
                )}
              </div>
            ) : null}
          </Card>
        </div>

        <div className="px-4 lg:px-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>History</CardTitle>
              <CardDescription>
                Issued, presented, verified, used, revoked, and expired — with
                who, scopes, outcome, and why.
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
                    Nothing in this passport’s trail matches the current
                    filters.
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
                            <p className="font-medium">
                              {KIND_LABELS[event.kind]}
                            </p>
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
                              event.outcome === "allowed"
                                ? "secondary"
                                : "destructive"
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
                {history.status === "CanLoadMore" ||
                history.status === "LoadingMore" ? (
                  <div className="flex justify-center border-t p-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={history.status === "LoadingMore"}
                      onClick={() => history.loadMore(50)}
                    >
                      {history.status === "LoadingMore"
                        ? "Loading…"
                        : "Load more"}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </div>
      </div>
    </BoardShell>
  );
}
