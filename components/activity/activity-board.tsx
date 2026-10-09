"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppMark } from "@/components/shared/app-mark";
import { Empty, PageHeading, Section } from "@/components/shared/page-parts";
import { ListSkeleton } from "@/components/layout/workspace-skeleton";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toolFor } from "@/shared/tools";

const decisionLabel: Record<string, string> = {
  allowed: "Allowed by rule",
  approved: "Approved by you",
  blocked: "Blocked by rule",
  denied: "Denied by you",
  waiting: "Asked you",
  "no-account": "No account connected",
  revoked: "Refused because the app is revoked",
};

export function ActivityBoard() {
  const calls = usePaginatedQuery(
    api.activity.list,
    {},
    { initialNumItems: 30 },
  );
  return (
    <>
      <PageHeading title="Activity">
        Every tool call from your apps. Scope logs which app called which tool
        and what was decided. It never stores messages or other content.
      </PageHeading>
      <Section>
        {calls.status === "LoadingFirstPage" ? (
          <ListSkeleton />
        ) : calls.results.length ? (
          calls.results.map((call) => {
            const tool = toolFor(call.tool);
            const failed =
              call.outcome === "failed" ||
              ["blocked", "denied", "no-account", "revoked"].includes(
                call.decision,
              );
            return (
              <div
                key={call._id}
                className="flex items-center gap-3 px-6 py-3.5"
              >
                {tool && <AppMark providerId={tool.providerId} />}
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">
                      {tool?.title ?? call.tool}
                    </span>{" "}
                    <span className="text-scope-quiet">
                      from {call.clientName}
                    </span>
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      failed ? "text-red-700" : "text-scope-quiet",
                    )}
                  >
                    {decisionLabel[call.decision]}
                    {call.outcome === "ok" && " and ran"}
                    {call.outcome === "failed" &&
                      ", but the provider call failed"}
                  </p>
                </div>
                <time className="text-xs whitespace-nowrap text-scope-quiet">
                  {formatTime(call._creationTime)}
                </time>
              </div>
            );
          })
        ) : (
          <Empty>Tool calls from your apps will appear here.</Empty>
        )}
      </Section>
      {calls.status === "CanLoadMore" && (
        <Button variant="outline" onClick={() => calls.loadMore(30)}>
          Load more
        </Button>
      )}
    </>
  );
}
