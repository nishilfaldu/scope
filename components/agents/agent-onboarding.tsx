"use client";

import { useState } from "react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.replace(/\/+$/, "");
const discoveryUrl = siteUrl ? `${siteUrl}/` : null;
const instructions = discoveryUrl
  ? `Connect yourself to my Scope account. Fetch ${discoveryUrl} and follow its integrationGuide and returned nextAction fields to complete pairing. Reuse an existing valid connection if you have one; otherwise create a pairing and show me its connectUrl.

Keep private claim handles and credentials in your runtime's private storage, out of chat and logs. Poll while waiting, then claim, persist, and acknowledge before the stated deadlines. If you need another chat turn to resume, tell me to reply "Continue" after approving.

Once connected, request only the apps and duration needed for my current task, showing me the approvalUrl. If I haven't given you a task, ask what I want done before requesting access. When you next run, tell me whether each request was approved, denied, or failed.`
  : null;

export function AgentOnboarding() {
  const [copied, setCopied] = useState(false);

  async function copyInstructions() {
    if (!instructions) return;
    try {
      await navigator.clipboard.writeText(instructions);
      setCopied(true);
      toast.add({ title: "Agent instructions copied", type: "success" });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.add({ title: "Could not copy instructions", type: "error" });
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Connect your agent</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Copy these instructions into the chat with the agent you want to
            use. It will give you a connection link to open and approve.
          </p>
        </div>
        {instructions ? (
          <Button type="button" onClick={() => void copyInstructions()}>
            <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
            {copied ? "Copied" : "Copy instructions"}
          </Button>
        ) : null}
      </div>
      {instructions ? (
        <>
          <textarea
            aria-label="Instructions to send to your agent"
            readOnly
            value={instructions}
            className="mt-5 min-h-64 w-full resize-y rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-5 text-foreground"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Pairing lets the agent request access. You approve accounts and
              duration separately.
            </span>
            <a
              href={discoveryUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4 hover:text-foreground"
            >
              View API discovery
            </a>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-destructive">
          Agent connection instructions are unavailable right now.
        </p>
      )}
    </section>
  );
}
