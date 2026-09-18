"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AccountBindings, bindingsFor } from "@/components/connections/account-bindings";
import { ExpiryTime } from "@/components/shared/expiry-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { APP_LABELS, APP_PERMISSIONS, type AppId } from "@/lib/capabilities";
import { useErrorCatchingMutation } from "@/lib/errors";

type Request = NonNullable<FunctionReturnType<typeof api.tables.slices.accessRequests.getByPublicToken>>;

function duration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? "day" : "days"}`;
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function ApprovalRow({ request, initiallyOpen, now }: { request: Request; initiallyOpen: boolean; now: number }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [selected, setSelected] = useState<Partial<Record<AppId, Id<"connections">[]>>>({});
  const [decide, isDeciding] = useErrorCatchingMutation(api.tables.slices.accessRequests.decide);
  const apps = request.kind === "onboarding" ? request.apps ?? [] : request.app ? [request.app] : [];
  const appNames = apps.map((app) => APP_LABELS[app]);
  const headline = request.kind === "onboarding"
    ? `${request.agentName || "An agent"} wants ${appNames.length <= 2 ? appNames.join(" and ") : `${appNames.length} apps`} access`
    : `${request.sliceName} wants ${appNames[0] ?? "account"} access`;
  const pending = request.status === "pending" && request.expiresAt > now;

  return <li>
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left hover:bg-muted/40">
          <span className="min-w-0 space-y-1">
            <span className="block font-medium">{headline}</span>
            <span className="block text-xs text-muted-foreground">
              {request.kind === "onboarding" ? "Creates a new slice" : "Issues a short-lived token"}
              {" · "}Expires <ExpiryTime expiresAt={request.expiresAt} now={now} />
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-muted-foreground">{open ? "−" : "+"}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-5 border-t px-6 py-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{request.kind === "onboarding" ? "Creates a new slice" : "Issues a token"}</Badge>
            {apps.map((app) => <Badge key={app} variant="secondary">{APP_LABELS[app]}</Badge>)}
          </div>
          {request.kind === "onboarding" && request.ttlMs ? <p className="text-sm">Access lasts <strong>{duration(request.ttlMs)}</strong> after approval.</p> : null}
          {request.reason ? <blockquote className="border-l-2 border-primary/50 pl-4 text-sm italic">
            “{request.reason}”
            <span className="mt-1 block text-xs not-italic text-muted-foreground">Reason supplied by the requester</span>
          </blockquote> : null}
          <section className="space-y-3" aria-label="Requested access">
            <h3 className="font-medium">Requested access</h3>
            {apps.map((app) => <div key={app} className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">{APP_LABELS[app]}</p>
              <p className="mt-1 text-base font-medium">{APP_PERMISSIONS[app]}</p>
            </div>)}
            {request.kind === "onboarding" && pending ? <AccountBindings
              apps={apps} selected={selected} compact allowConnect={false}
              onChange={(app, ids) => setSelected((current) => ({ ...current, [app]: ids }))}
            /> : request.accountLogin ? <p className="text-sm">Account: <strong>{request.accountLogin}</strong></p>
              : request.kind === "mint" && pending ? <p className="text-sm text-destructive">This account is no longer connected.</p> : null}
          </section>
          {request.kind === "onboarding" ? <div className="flex gap-3 rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground">
            <HugeiconsIcon icon={Shield01Icon} strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-2">
              <p>The requester supplied the agent name; Agent Passport has not verified it.</p>
              <p>Approving lets the agent request provider tokens for the selected accounts. Disabling this slice stops future requests; tokens already issued may work until they expire.</p>
            </div>
          </div> : null}
          <p className="text-xs text-muted-foreground">Expires <ExpiryTime expiresAt={request.expiresAt} now={now} /></p>
          {pending ? <div className="flex gap-2">
            <Button disabled={isDeciding || (request.kind === "mint" && !request.accountLogin) ||
              (request.kind === "onboarding" && apps.some((app) => !selected[app]?.length))}
              onClick={() => void decide({
                requestId: request._id, decision: "approved",
                bindings: request.kind === "onboarding" ? bindingsFor(apps, selected) : undefined,
              })}>Approve</Button>
            <Button variant="outline" disabled={isDeciding}
              onClick={() => void decide({ requestId: request._id, decision: "denied" })}>Deny</Button>
          </div> : <p className="text-sm text-muted-foreground">This request is {request.status}.</p>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  </li>;
}
