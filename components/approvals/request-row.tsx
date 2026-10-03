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
  accessBoundary,
  requestExplanation,
  type ApprovalAccount,
  type ApprovalRequest,
} from "@/lib/approval-display";

export function RequestRow({
  request,
  account,
  now,
  focused = false,
  onDecision,
}: {
  request: ApprovalRequest;
  account?: ApprovalAccount;
  now: number;
  focused?: boolean;
  onDecision?: () => void;
}) {
  const decide = useMutation(api.probe.decide),
    cancel = useMutation(api.probe.cancel);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [open, setOpen] = useState(focused),
    [confirm, setConfirm] = useState(false);
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  const status = approvalStatus(request, now, account?.revoked),
    pending = status === "Needs approval";
  const attention = ["Receipt unconfirmed", "Not collected"].includes(status);
  const canStop =
    request.status === "approved" &&
    deliveryDeadline(request) > now &&
    !account?.revoked &&
    !request.requesterStopped;
  const time = requestTime(request, now),
    name = request.requesterName ?? "MCP connection";
  async function act(action: "approve" | "deny" | "stop") {
    onDecision?.();
    setBusy(true);
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
      setBusy(false);
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
          aria-expanded={open}
          aria-controls={`detail-${request._id}`}
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
            <span>
              {request.requesterSource ?? "Authorized MCP connection"}
            </span>
          </span>
          <span className={styles.summaryEnd}>
            <time dateTime={time ? new Date(time).toISOString() : undefined}>
              {pending
                ? `${Math.max(1, Math.ceil((request.expiresAt - now) / 60_000))} min to decide`
                : time
                  ? formatRequestTime(time)
                  : ""}
            </time>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={16}
              className={open ? styles.rotated : ""}
            />
          </span>
        </button>
        <div className={styles.requestBody}>
          <div className={styles.access}>
            <AppMark app="Airtable" />
            <div>
              <p>{requestAccess(request)}</p>
              <span>
                Airtable / {accountName(account?.baseName || account?.label)}
              </span>
              {pending && (
                <p className={styles.permission}>{accessBoundary(account)}</p>
              )}
            </div>
          </div>
          {pending ? (
            <div className={styles.decision}>
              <Button
                className={styles.approve}
                disabled={busy || !account?.providerUserId}
                onClick={() => void act("approve")}
              >
                {busy ? "Saving…" : "Approve"}
              </Button>
              <Button
                variant="outline"
                className={styles.deny}
                disabled={busy}
                onClick={() => void act("deny")}
              >
                Deny
              </Button>
            </div>
          ) : (
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
          )}
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      {open && (
        <div id={`detail-${request._id}`} className={styles.requestDetail}>
          {requestExplanation(request, now, account) && (
            <p className={styles.explanation}>
              {requestExplanation(request, now, account)}
            </p>
          )}
          {!pending && (
            <ol aria-label="Request timeline" className={styles.evidence}>
              {requestTimeline(request, now, account).map((event, i, all) => (
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
          {!pending && (
            <p className={styles.detailNote}>{accessBoundary(account)}</p>
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
              Previously received access may remain active at Airtable.
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
              {busy ? "Stopping…" : "Stop sharing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
