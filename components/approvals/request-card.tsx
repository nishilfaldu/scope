"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DecisionFact, DecisionFacts } from "@/components/shared/decision-card";
import {
  approvalStatus,
  receiptDescription,
  type ApprovalAccount,
  type ApprovalRequest,
} from "@/lib/approval-display";

export function RequestCard({
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
  const decide = useMutation(api.probe.decide);
  const cancel = useMutation(api.probe.cancel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = approvalStatus(request, now, account?.revoked);
  const pending = status === "Needs approval";
  async function act(action: "approve" | "deny" | "stop") {
    setBusy(true);
    setError("");
    try {
      if (action === "stop") await cancel({ id: request._id });
      else await decide({ id: request._id, approve: action === "approve" });
    } catch {
      setError(
        "This request may have changed or expired. Check its status and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      id={`request-${request._id}`}
      aria-label={`Request for ${account?.label ?? "unavailable account"}`}
      className={`min-w-0 scroll-mt-6 overflow-hidden rounded-xl border bg-card ${focused ? "ring-2 ring-ring/40" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold"
          >
            A
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Airtable</p>
            <h2 className="break-words text-sm font-semibold">
              {account?.label ?? "Account unavailable"}
            </h2>
          </div>
        </div>
        <Badge variant={pending ? "default" : "secondary"}>{status}</Badge>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        <p className="break-words text-base leading-7">{request.reason}</p>
        <DecisionFacts>
          <DecisionFact label="Access">
            {account?.credentialKind === "shared-pat"
              ? "Read-only access to the configured base"
              : "Access to this connected account"}
          </DecisionFact>
          <DecisionFact label="Delivery ends">
            {new Date(request.expiresAt).toLocaleString()}
          </DecisionFact>
          <DecisionFact label="Recipient">
            <span className="text-sm">
              {request.requester.startsWith("scope:")
                ? "WorkOS-authorized helper"
                : "Connected Scope agent"}
            </span>
          </DecisionFact>
        </DecisionFacts>
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-ring">
            View exact recipient and account
          </summary>
          <dl className="mt-3 space-y-2 break-all leading-5">
            <div>
              <dt className="font-medium text-foreground">
                Authenticated recipient
              </dt>
              <dd>{request.requester}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Scope account</dt>
              <dd>{request.accountId}</dd>
            </div>
            {account?.providerUserId && (
              <div>
                <dt className="font-medium text-foreground">
                  Airtable identity
                </dt>
                <dd>{account.providerUserId}</dd>
              </div>
            )}
            {account?.baseId && (
              <div>
                <dt className="font-medium text-foreground">Base</dt>
                <dd>{account.baseId}</dd>
              </div>
            )}
          </dl>
        </details>
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          {receiptDescription(request, now, account?.revoked)}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {pending && (
          <div className="grid grid-cols-2 gap-3 border-t pt-5">
            <Button
              className="h-11"
              disabled={busy || !account}
              onClick={() => void act("approve")}
            >
              {busy ? "Saving…" : "Approve access"}
            </Button>
            <Button
              className="h-11"
              variant="outline"
              disabled={busy}
              onClick={() => void act("deny")}
            >
              Deny
            </Button>
          </div>
        )}
        {status === "Approved" && (
          <div className="space-y-2 border-t pt-4">
            <Button
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => void act("stop")}
            >
              {busy ? "Stopping…" : "Stop further delivery"}
            </Button>
            <p className="text-xs leading-5 text-muted-foreground">
              Stops another delivery through this approval. A credential already
              received remains active at Airtable.
            </p>
          </div>
        )}
      </div>
    </article>
  );
}
