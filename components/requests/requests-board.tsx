"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppMark } from "@/components/shared/app-mark";
import {
  Empty,
  PageHeading,
  Section,
  Spinner,
} from "@/components/shared/page-parts";
import { ListSkeleton } from "@/components/layout/workspace-skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-now";
import { errorMessage, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { providerName } from "@/shared/connectors";
import { toolFor } from "@/shared/tools";

type Approval = FunctionReturnType<
  typeof api.approvals.open
>["pending"][number];
type Account = FunctionReturnType<typeof api.accounts.list>[number];

const statusLabel: Record<string, string> = {
  denied: "Denied",
  ended: "Ended",
  expired: "Expired",
};

const times = (count: number) => (count === 1 ? "once" : `${count} times`);

export function RequestsBoard({ focusId }: { focusId?: string }) {
  const open = useQuery(api.approvals.open, {});
  const accounts = useQuery(api.accounts.list, {});
  const history = usePaginatedQuery(
    api.approvals.history,
    {},
    { initialNumItems: 20 },
  );
  const pending = open?.pending.length ?? 0;
  return (
    <>
      <PageHeading title="Requests">
        {open === undefined
          ? "Apps ask here before they run a tool."
          : pending
            ? `${pending} request${pending === 1 ? " needs" : "s need"} your decision.`
            : "No requests need your decision."}
      </PageHeading>
      <Section title="Needs approval">
        {open === undefined || accounts === undefined ? (
          <ListSkeleton rows={1} />
        ) : open.pending.length ? (
          open.pending.map((row) => (
            <PendingRequest
              key={row._id}
              request={row}
              accounts={accounts.filter((a) => a.providerId === row.providerId)}
              focused={row._id === focusId}
            />
          ))
        ) : (
          <Empty>No requests waiting.</Empty>
        )}
      </Section>
      <Section title="Active approvals">
        {open === undefined ? (
          <ListSkeleton rows={1} />
        ) : open.approved.length ? (
          open.approved.map((row) => (
            <ActiveApproval
              key={row._id}
              approval={row}
              focused={row._id === focusId}
            />
          ))
        ) : (
          <Empty>No active approvals.</Empty>
        )}
      </Section>
      <Section title="History">
        {history.status === "LoadingFirstPage" ? (
          <ListSkeleton />
        ) : history.results.length ? (
          history.results.map((row) => (
            <Row key={row._id} approval={row} focused={row._id === focusId}>
              <p className="text-xs text-scope-quiet">
                {statusLabel[row.status]} on{" "}
                {formatTime(row.endedAt ?? row.decidedAt ?? row._creationTime)}
                {row.collections > 0 && `, used ${times(row.collections)}`}
              </p>
            </Row>
          ))
        ) : (
          <Empty>Past requests will appear here.</Empty>
        )}
      </Section>
      {history.status === "CanLoadMore" && (
        <Button variant="outline" onClick={() => history.loadMore(20)}>
          Load more
        </Button>
      )}
    </>
  );
}

function Row({
  approval,
  focused,
  children,
}: {
  approval: Approval;
  focused: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  return (
    <article
      ref={ref}
      aria-label={`${approval.appName}: ${approval.reason}`}
      className={cn("flex gap-3 px-6 py-5", focused && "bg-scope-hover/60")}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-scope-hover text-xs font-semibold text-scope-green">
        {initials(approval.appName)}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <strong className="font-medium">{approval.appName}</strong>
          <span className="text-scope-quiet">wants</span>
          <AppMark providerId={approval.providerId} />
          <span>
            {providerName(approval.providerId)}:{" "}
            {toolFor(approval.tool)?.title ?? approval.tool}
          </span>
          {approval.accountLabel && (
            <span className="text-scope-quiet">
              with {approval.accountLabel}
            </span>
          )}
        </p>
        <p className="leading-relaxed break-words">{approval.reason}</p>
        {children}
      </div>
    </article>
  );
}

function PendingRequest({
  request,
  accounts,
  focused,
}: {
  request: Approval;
  accounts: Account[];
  focused: boolean;
}) {
  const approve = useMutation(api.approvals.approve),
    deny = useMutation(api.approvals.deny);
  const [accountId, setAccountId] = useState<Id<"accounts"> | undefined>(
    accounts[0]?._id,
  );
  const durations = [0, 15, 30, 60] as const;
  const [minutes, setMinutes] = useState<0 | 15 | 30 | 60>(0);
  const [busy, setBusy] = useState<"approve" | "deny">();
  const now = useNow(),
    left = Math.ceil((request.expiresAt - now) / 60_000);
  const selected = accountId ?? accounts[0]?._id;
  async function act(action: "approve" | "deny") {
    setBusy(action);
    try {
      if (action === "deny") await deny({ id: request._id });
      else if (selected)
        await approve({ id: request._id, accountId: selected, minutes });
    } catch (error) {
      toast.add({
        title: errorMessage(error),
        type: "error",
        priority: "high",
      });
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <Row approval={request} focused={focused}>
      <p className="text-xs text-scope-quiet">
        {left > 0 ? `${left} min to decide` : "Closing…"}
      </p>
      {accounts.length === 0 ? (
        <p className="text-scope-quiet">
          <Link className="text-scope-green underline" href="/accounts">
            Connect a {providerName(request.providerId)} account
          </Link>{" "}
          to approve this request.
        </p>
      ) : (
        accounts.length > 1 && (
          <label className="flex items-center gap-2 text-scope-quiet">
            Account
            <select
              className="h-9 rounded-lg border border-scope-line bg-white px-2 text-scope-ink"
              value={selected}
              onChange={(e) => setAccountId(e.target.value as Id<"accounts">)}
            >
              {accounts.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        )
      )}
      <fieldset disabled={!!busy} className="pt-1">
        <legend className="mb-2 text-xs text-scope-quiet">
          Approve this call only, or let the app use this tool without asking
          for
        </legend>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {durations.map((value) => (
              <Button
                key={value}
                variant={minutes === value ? "secondary" : "outline"}
                aria-pressed={minutes === value}
                onClick={() => setMinutes(value)}
              >
                {value === 0
                  ? "This call only"
                  : value === 60
                    ? "1 hour"
                    : `${value} min`}
              </Button>
            ))}
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Button
              disabled={!!busy || !selected}
              onClick={() => void act("approve")}
            >
              {busy === "approve" && <Spinner />}
              Approve
            </Button>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => void act("deny")}
            >
              {busy === "deny" && <Spinner />}
              Deny
            </Button>
          </div>
        </div>
      </fieldset>
    </Row>
  );
}

function ActiveApproval({
  approval,
  focused,
}: {
  approval: Approval;
  focused: boolean;
}) {
  const end = useMutation(api.approvals.end);
  const [busy, setBusy] = useState(false);
  return (
    <Row approval={approval} focused={focused}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-scope-quiet">
          {approval.once
            ? `Approved for one call, until ${formatTime(approval.expiresAt)}`
            : `Approved until ${formatTime(approval.expiresAt)}`}
          {approval.lastCollectedAt !== undefined &&
            `. Used ${times(approval.collections)}, last at ${formatTime(approval.lastCollectedAt)}`}
        </p>
        <Button
          variant="ghost"
          className="ml-auto text-scope-green"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            end({ id: approval._id })
              .catch((error) =>
                toast.add({
                  title: errorMessage(error),
                  type: "error",
                  priority: "high",
                }),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy && <Spinner />}
          End approval
        </Button>
      </div>
    </Row>
  );
}
