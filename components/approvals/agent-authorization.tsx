"use client";
import { useState } from "react";
import { BoardShell } from "@/components/layout/board-shell";
import styles from "@/components/scope/scope.module.css";
import { Button } from "@/components/ui/button";
import { approvalPost } from "@/lib/approval-display";

export function AgentAuthorization({
  externalAuthId,
}: {
  externalAuthId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function continueAuthorization() {
    setBusy(true);
    setError("");
    try {
      const result = await approvalPost<{ url: string }>("workos", {
        external_auth_id: externalAuthId,
      });
      location.assign(result.url);
    } catch {
      setError(
        "This sign-in could not be continued. Try again, or start a fresh sign-in from your helper.",
      );
      setBusy(false);
    }
  }
  return (
    <BoardShell title="Connect an agent">
      <div className="max-w-xl">
        <header className={styles.pageHeading}>
          <h1>Connect an agent</h1>
          <p>Each account access request still needs your approval.</p>
        </header>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {externalAuthId ? (
          <Button
            className={styles.approve}
            disabled={busy}
            onClick={() => void continueAuthorization()}
          >
            {busy ? "Continuing…" : "Continue"}
          </Button>
        ) : (
          <p role="status" className="text-sm">
            Start sign-in from your local helper to continue here.
          </p>
        )}
      </div>
    </BoardShell>
  );
}
