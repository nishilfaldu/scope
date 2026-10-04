"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Tick02Icon,
  HourglassIcon,
  MailReceive01Icon,
  Cancel01Icon,
  Timer02Icon,
  PackageRemoveIcon,
  HelpCircleIcon,
  PauseIcon,
  Clock01Icon,
  CheckmarkCircle02Icon,
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
  requestDecision,
  requestDelivery,
  requestActivity,
  requestAccess,
  type ApprovalRequest,
} from "@/lib/approval-display";

export function RequestRow({
  request,
  focused = false,
  onDecision,
}: {
  request: ApprovalRequest;
  focused?: boolean;
  onDecision?: () => void;
}) {
  const decide = useMutation(api.approvals.decide);
  const [busyAction, setBusyAction] = useState<"approve" | "deny" | null>(null);
  const busy = busyAction !== null;
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  const status = approvalStatus(request),
    pending = status === "Needs approval";
  const decision = requestDecision(request),
    delivery = requestDelivery(request);
  const outcomeIcons = {
    Approved: CheckmarkCircle02Icon,
    Denied: Cancel01Icon,
    Expired: Timer02Icon,
    "Not decided": Clock01Icon,
    Cancelled: PauseIcon,
    "Waiting for pickup": HourglassIcon,
    "Waiting for receipt": MailReceive01Icon,
    Received: Tick02Icon,
    "Not collected": PackageRemoveIcon,
    "Receipt unconfirmed": HelpCircleIcon,
    "Delivery stopped": PauseIcon,
  };
  const time = request.createdAt,
    name = request.snapshot.requesterName;
  async function act(action: "approve" | "deny") {
    onDecision?.();
    setBusyAction(action);
    try {
      await decide({ id: request._id, approve: action === "approve" });
    } catch {
      toast.add({
        title:
          "This request changed or expired. Check its status and try again.",
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
      aria-label={`${name}: ${requestAccess(request)}`}
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
            <span>{"Authorized CLI connection"}</span>
          </span>
          <span className={styles.summaryEnd}>
            {pending ? (
              <RequestCountdown deadline={request.approvalExpiresAt} />
            ) : (
              <time
                dateTime={
                  time !== undefined ? new Date(time).toISOString() : undefined
                }
              >
                {time !== undefined ? formatRequestTime(time) : ""}
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
          <div className={styles.requestCommand}>
            <span>Command</span>
            <code>{request.command.argv.join(" ")}</code>
          </div>
          {pending ? (
            <div className={styles.decision}>
              <Button
                className={styles.approve}
                disabled={busy}
                onClick={() => void act("approve")}
              >
                {busyAction === "approve" && (
                  <span className={styles.spinner} aria-hidden />
                )}
                Approve
              </Button>
              <Button
                variant="outline"
                className={styles.deny}
                disabled={busy}
                onClick={() => void act("deny")}
              >
                {busyAction === "deny" && (
                  <span className={styles.spinner} aria-hidden />
                )}
                Deny
              </Button>
            </div>
          ) : (
            <>
              <dl
                className={styles.requestOutcomes}
                aria-label="Request outcome"
              >
                {[
                  { category: "Decision", outcome: decision },
                  ...(delivery
                    ? [{ category: "Delivery", outcome: delivery }]
                    : []),
                ].map(({ category, outcome }) => (
                  <div key={category}>
                    <dt>{category}</dt>
                    <dd>
                      <HugeiconsIcon
                        icon={outcomeIcons[outcome.label]}
                        size={16}
                        aria-hidden
                      />
                      <span>{outcome.label}</span>
                      {outcome.at !== undefined && (
                        <time dateTime={new Date(outcome.at).toISOString()}>
                          {formatRequestTime(outcome.at)}
                        </time>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <Collapsible className={styles.requestActivity}>
            <CollapsibleTrigger className={styles.activityTrigger}>
              <HugeiconsIcon icon={ArrowDown01Icon} size={14} aria-hidden />
              Activity
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol aria-label="Request activity" className={styles.activityList}>
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
  const now = useNow();
  const minutes = Math.ceil((deadline - now) / 60_000);
  return (
    <time dateTime={new Date(deadline).toISOString()}>
      {minutes > 0 ? `${minutes} min to decide` : "Closing…"}
    </time>
  );
}
