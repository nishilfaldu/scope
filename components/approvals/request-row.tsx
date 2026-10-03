"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  accountName,
  approvalStatus,
  deliveryDeadline,
  formatRequestTime,
  requestOutcome,
  requestTime,
  requestTimeline,
  type ApprovalAccount,
  type ApprovalRequest,
} from "@/lib/approval-display";

export function RequestRow({
  request,
  account,
  now,
  focused = false,
}: {
  request: ApprovalRequest;
  account?: ApprovalAccount;
  now: number;
  focused?: boolean;
}) {
  const decide = useMutation(api.probe.decide),
    cancel = useMutation(api.probe.cancel);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [open, setOpen] = useState(focused);
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  const status = approvalStatus(request, now, account?.revoked);
  const pending = status === "Needs approval";
  const stopped = [
    "Delivery stopped",
    "Sharing blocked",
    "Expired",
    "Not collected",
    "Receipt unconfirmed",
  ].includes(status);
  const time = requestTime(request, now);
  const timeLabel = request.stoppedAt
    ? "Stopped"
    : request.receivedAt
      ? "Received"
      : request.status === "denied"
        ? "Denied"
        : deliveryDeadline(request) <= now && request.status !== "cancelled"
          ? "Ended"
          : request.deliveredAt
            ? "Attempted"
            : request.decidedAt
              ? "Approved"
              : "Requested";
  const canStop =
    request.status === "approved" &&
    deliveryDeadline(request) > now &&
    !account?.revoked;
  async function act(action: "approve" | "deny" | "stop") {
    setBusy(true);
    setError("");
    try {
      if (action === "stop") await cancel({ id: request._id });
      else await decide({ id: request._id, approve: action === "approve" });
    } catch {
      setError(
        "This request changed or expired. Check its status and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <article
        ref={row}
        aria-label={`Request from ${request.requesterName ?? "Local helper"} for ${accountName(account?.label)}`}
        className={`scroll-mt-4 px-4 py-4 sm:px-5 ${focused ? "bg-muted/40" : ""}`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <CollapsibleTrigger
            className="group flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${open ? "Hide" : "Show"} request timeline`}
          >
            <span
              aria-hidden
              className={`mt-1 size-2 shrink-0 rounded-full ${pending ? "bg-primary" : status === "Received" ? "bg-emerald-600" : "bg-muted-foreground/40"}`}
            />
            <span className="min-w-0 flex-1 space-y-1 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-5 sm:space-y-0">
              <span className="block truncate text-sm font-semibold sm:col-start-1">
                {request.requesterName ?? "Local helper"}
              </span>
              <span className="block break-words text-sm text-muted-foreground sm:col-start-1 sm:row-start-2 sm:mt-1">
                Airtable <span aria-hidden>·</span>{" "}
                {accountName(account?.label)}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:flex-col sm:items-end sm:pt-0">
                <Badge
                  variant={pending ? "default" : "secondary"}
                  className={
                    stopped
                      ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                      : ""
                  }
                >
                  {status}
                </Badge>
                {time && (
                  <time
                    dateTime={new Date(time).toISOString()}
                    className="text-xs text-muted-foreground"
                  >
                    {timeLabel} {formatRequestTime(time)}
                  </time>
                )}
              </span>
              {!pending && status !== "Received" && status !== "Denied" && (
                <span className="block text-xs leading-5 text-muted-foreground sm:col-span-2 sm:mt-1">
                  {requestOutcome(request, now, account?.revoked)}
                </span>
              )}
              {pending && (
                <span className="block text-xs text-muted-foreground sm:col-span-2 sm:mt-1">
                  {account?.credentialKind === "shared-pat"
                    ? "Read-only"
                    : "Account access"}{" "}
                  · Decide by {formatRequestTime(request.expiresAt)}
                </span>
              )}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              aria-hidden
              className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          {pending && (
            <div className="grid grid-cols-2 gap-2 pl-5 sm:flex sm:shrink-0 sm:pl-0">
              <Button
                className="h-11 px-5"
                disabled={busy || !account?.providerUserId}
                onClick={() => void act("approve")}
              >
                {busy ? "Saving…" : "Approve"}
              </Button>
              <Button
                variant="outline"
                className="h-11 px-5"
                disabled={busy}
                onClick={() => void act("deny")}
              >
                Deny
              </Button>
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 pl-5 text-sm text-destructive">
            {error}
          </p>
        )}
        <CollapsibleContent>
          <div className="pl-5 pt-5">
            <ol aria-label="Request timeline" className="space-y-0">
              {requestTimeline(request, now, account).map(
                (event, i, events) => (
                  <li
                    key={`${event.label}-${i}`}
                    className="relative flex gap-3 pb-5 last:pb-0"
                  >
                    {i < events.length - 1 && (
                      <span
                        aria-hidden
                        className="absolute bottom-0 left-2 top-5 w-px bg-border"
                      />
                    )}
                    <span
                      aria-hidden
                      className={`relative mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${event.tone === "done" ? "bg-muted text-foreground" : event.tone === "waiting" ? "border border-ring bg-background" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}
                    >
                      {event.tone === "done" ? (
                        <HugeiconsIcon icon={Tick02Icon} className="size-3" />
                      ) : (
                        <span className="size-1 rounded-full bg-current" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p
                          className={`text-sm ${event.tone !== "done" ? "font-medium" : ""}`}
                        >
                          {event.label}
                        </p>
                        {event.at && (
                          <time
                            dateTime={new Date(event.at).toISOString()}
                            className="text-xs text-muted-foreground"
                          >
                            {formatRequestTime(event.at)}
                          </time>
                        )}
                      </div>
                      {event.detail && (
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {event.detail}
                        </p>
                      )}
                    </div>
                  </li>
                ),
              )}
            </ol>
            {request.receivedAt &&
              request.status === "approved" &&
              !account?.revoked &&
              deliveryDeadline(request) > now && (
                <p className="mt-4 text-xs text-muted-foreground">
                  Further delivery is allowed until{" "}
                  {formatRequestTime(deliveryDeadline(request))}.
                </p>
              )}
            {canStop && (
              <div className="mt-4 flex flex-col items-start gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10"
                  disabled={busy}
                  onClick={() => void act("stop")}
                >
                  {busy ? "Stopping…" : "Stop further delivery"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Access already received is unaffected.
                </p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </article>
    </Collapsible>
  );
}
