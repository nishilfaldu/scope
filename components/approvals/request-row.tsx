"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  Timer02Icon,
  PauseIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { toast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-now";
import { AppMark } from "@/components/scope/app-mark";
import styles from "@/components/scope/scope.module.css";
import {
  accountName,
  approvalStatus,
  formatRequestTime,
  requestActivity,
  type ApprovalRequest,
} from "@/lib/approval-display";
export function RequestRow({
  request,
  focused = false,
}: {
  request: ApprovalRequest;
  focused?: boolean;
}) {
  const decide = useMutation(api.access.decide),
    end = useMutation(api.access.end);
  const [busyAction, setBusyAction] = useState<
      "approve" | "deny" | "end" | null
    >(null),
    [minutes, setMinutes] = useState<15 | 30 | 60>(30);
  const busy = busyAction !== null,
    row = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  const pending = request.status === "pending",
    name = request.snapshot.agentName;
  const status = approvalStatus(request),
    icons = {
      Approved: CheckmarkCircle02Icon,
      Denied: Cancel01Icon,
      Expired: Timer02Icon,
      Ended: PauseIcon,
      "Needs approval": Clock01Icon,
    };
  async function act(action: "approve" | "deny" | "end") {
    setBusyAction(action);
    try {
      if (action === "end") await end({ id: request._id });
      else
        await decide({
          id: request._id,
          approve: action === "approve",
          minutes,
        });
    } catch {
      toast.add({
        title:
          "This approval changed or expired. Check its status and try again.",
        type: "error",
        priority: "high",
      });
    } finally {
      setBusyAction(null);
    }
  }
  return (
    <article
      ref={row}
      aria-label={`${name}: ${request.reason}`}
      className={`${styles.request} ${pending ? styles.pending : ""}`}
    >
      <div className={styles.requestHead}>
        <div className={styles.requestSummary}>
          <span className={styles.avatar}>
            {name
              .split(/\s+/)
              .slice(0, 2)
              .map((n) => n[0])
              .join("")
              .toUpperCase()}
          </span>
          <span className={styles.who}>
            <strong>{name}</strong>
            <span>CLI access request</span>
          </span>
          <span className={styles.summaryEnd}>
            {pending ? (
              <RequestCountdown deadline={request.waitingUntil} />
            ) : (
              <time dateTime={new Date(request._creationTime).toISOString()}>
                {formatRequestTime(request._creationTime)}
              </time>
            )}
          </span>
        </div>
        <div className={styles.requestBody}>
          <div className={styles.access}>
            <AppMark app={request.snapshot.providerName} />
            <div>
              <p>{request.snapshot.providerName}</p>
              <span>{accountName(request.snapshot.accountLabel)}</span>
            </div>
          </div>
          <div className={styles.requestReason}>
            <span>Reason</span>
            <p>{request.reason}</p>
          </div>
          {pending ? (
            <>
              <fieldset className={styles.durationChoices} disabled={busy}>
                <legend>Allow token requests without asking again for</legend>
                <div>
                  {([15, 30, 60] as const).map((value) => (
                    <Button
                      key={value}
                      variant={minutes === value ? "default" : "outline"}
                      aria-pressed={minutes === value}
                      onClick={() => setMinutes(value)}
                    >
                      {value === 60 ? "1 hour" : `${value} min`}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <div className={styles.decision}>
                <Button
                  className={styles.approve}
                  disabled={busy || !request.accountAvailable}
                  onClick={() => void act("approve")}
                >
                  {busyAction === "approve" && (
                    <span className={styles.spinner} aria-hidden />
                  )}
                  Approve
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !request.accountAvailable}
                  onClick={() => void act("deny")}
                >
                  {busyAction === "deny" && (
                    <span className={styles.spinner} aria-hidden />
                  )}
                  Deny
                </Button>
              </div>
            </>
          ) : (
            <div className={styles.accessStatus}>
              <span>
                <HugeiconsIcon icon={icons[status]} size={16} aria-hidden />
                {request.status === "active" && request.until !== undefined
                  ? `Approved until ${formatRequestTime(request.until)}`
                  : status}
              </span>
              {request.status === "active" && (
                <Button
                  variant="ghost"
                  className={styles.actionButton}
                  disabled={busy}
                  onClick={() => void act("end")}
                >
                  {busyAction === "end" && (
                    <span className={styles.spinner} aria-hidden />
                  )}
                  End approval
                </Button>
              )}
            </div>
          )}
          <Collapsible className={styles.requestActivity}>
            <CollapsibleTrigger className={styles.activityTrigger}>
              <HugeiconsIcon icon={ArrowDown01Icon} size={14} aria-hidden />
              Activity
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol
                aria-label="Approval activity"
                className={styles.activityList}
              >
                {requestActivity(request).map((event, i) => (
                  <li key={`${event.label}-${i}`}>
                    <span>{event.label}</span>
                    {event.at !== undefined && (
                      <time dateTime={new Date(event.at).toISOString()}>
                        {formatRequestTime(event.at)}
                      </time>
                    )}
                  </li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </article>
  );
}
function RequestCountdown({ deadline }: { deadline: number }) {
  const now = useNow(),
    minutes = Math.ceil((deadline - now) / 60_000);
  return (
    <time dateTime={new Date(deadline).toISOString()}>
      {minutes > 0 ? `${minutes} min to decide` : "Closing…"}
    </time>
  );
}
