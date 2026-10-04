"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AppMark } from "@/components/scope/app-mark";
import styles from "@/components/scope/scope.module.css";
import {
  accountName,
  approvalStatus,
  deliveryDeadline,
  formatRequestTime,
  requestTime,
  requestTimeline,
  requestAccess,
  type ApprovalRequest,
} from "@/lib/approval-display";

export function RequestRow({
  request,
  now,
  focused = false,
  onDecision,
}: {
  request: ApprovalRequest;
  now: number;
  focused?: boolean;
  onDecision?: () => void;
}) {
  const decide = useMutation(api.approvals.decide),
    cancel = useMutation(api.approvals.cancel);
  const [busyAction, setBusyAction] = useState<
    "approve" | "deny" | "stop" | null
  >(null);
  const busy = busyAction !== null;
  const [error, setError] = useState("");
  const [open, setOpen] = useState(focused),
    [confirm, setConfirm] = useState(false);
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  const status = approvalStatus(request, now),
    pending = status === "Needs approval";
  const attention = ["Receipt unconfirmed", "Not collected"].includes(status);
  const canStop =
    request.status === "approved" &&
    deliveryDeadline(request) > now &&
    request.accountAvailable &&
    !request.requesterStopped;
  const time = requestTime(request, now),
    name = request.snapshot.requesterName;
  async function act(action: "approve" | "deny" | "stop") {
    onDecision?.();
    setBusyAction(action);
    setError("");
    try {
      if (action === "stop") await cancel({ id: request._id });
      else await decide({ id: request._id, approve: action === "approve" });
      setConfirm(false);
    } catch {
      setError(
        "This request changed or expired. Check its status and try again.",
      );
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
        <button
          className={styles.requestSummary}
          disabled={pending}
          aria-expanded={pending ? undefined : open}
          aria-controls={pending ? undefined : `detail-${request._id}`}
          onClick={() => setOpen(!open)}
        >
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
            <time dateTime={time ? new Date(time).toISOString() : undefined}>
              {pending
                ? `${Math.max(1, Math.ceil((request.approvalExpiresAt - now) / 60_000))} min to decide`
                : time
                  ? formatRequestTime(time)
                  : ""}
            </time>
            {!pending && (
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={16}
                className={open ? styles.rotated : ""}
              />
            )}
          </span>
        </button>
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
          ) : !open ? (
            <button
              className={`${styles.outcome} ${attention ? styles.attention : ""}`}
              aria-expanded={open}
              aria-controls={`detail-${request._id}`}
              onClick={() => setOpen(!open)}
            >
              {status === "Received" && (
                <HugeiconsIcon icon={Tick02Icon} size={14} />
              )}
              {status === "Waiting for pickup"
                ? "Approved · waiting for agent"
                : status === "Waiting for receipt"
                  ? "Waiting for receipt"
                  : status}
              {attention && <span aria-hidden>?</span>}
            </button>
          ) : null}
        </div>
        {pending && (
          <p className={styles.detailNote}>
            <strong>Command</strong>
            <br />
            <code className="break-all text-xs">
              {request.command.argv.join(" ")}
            </code>
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      {open && !pending && (
        <div id={`detail-${request._id}`} className={styles.requestDetail}>
          {!pending && (
            <ol aria-label="Request timeline" className={styles.evidence}>
              {requestTimeline(request, now).map((event, i, all) => (
                <li
                  key={`${event.label}-${i}`}
                  className={
                    i === all.length - 1
                      ? `${styles.latest} ${attention ? styles.attention : ""}`
                      : ""
                  }
                >
                  <span aria-hidden />
                  {event.label}
                  {event.at && (
                    <time dateTime={new Date(event.at).toISOString()}>
                      {formatRequestTime(event.at)}
                    </time>
                  )}
                </li>
              ))}
            </ol>
          )}
          {canStop && (
            <button
              className={styles.textAction}
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              Stop further sharing
            </button>
          )}
        </div>
      )}
      <Dialog
        open={confirm}
        onOpenChange={(next) => {
          if (!busy) setConfirm(next);
        }}
      >
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>Stop further sharing?</DialogTitle>
            <DialogDescription>
              Stop new access deliveries for this request.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Keep sharing
            </Button>
            <Button
              className={styles.approve}
              disabled={busy}
              onClick={() => void act("stop")}
            >
              {busy && <span className={styles.spinner} aria-hidden />}
              Stop sharing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
