"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthorizationShell } from "@/components/shared/authorization-shell";
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
    <AuthorizationShell>
      <div className="space-y-5 p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect an agent
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Each account access request still needs your approval.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {externalAuthId ? (
          <Button
            className="h-11 w-full"
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
        <Button
          variant="ghost"
          className="w-full"
          nativeButton={false}
          render={<Link href="/approvals" />}
        >
          Back to approvals
        </Button>
      </div>
    </AuthorizationShell>
  );
}
