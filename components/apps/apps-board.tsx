"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AppMark } from "@/components/shared/app-mark";
import { CopyField } from "@/components/shared/copy-field";
import {
  Empty,
  PageHeading,
  Section,
  Spinner,
} from "@/components/shared/page-parts";
import { ListSkeleton } from "@/components/layout/workspace-skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { errorMessage, formatTime } from "@/lib/format";
import { providerName } from "@/shared/connectors";
import {
  defaultRule,
  ruleLabel,
  tools,
  type Rule,
  type ToolInfo,
} from "@/shared/tools";

type App = FunctionReturnType<typeof api.clients.list>[number];

const providers = [...new Set(tools.map((tool) => tool.providerId))];

function notify(error: unknown) {
  toast.add({ title: errorMessage(error), type: "error", priority: "high" });
}

export function AppsBoard({ mcpUrl }: { mcpUrl: string }) {
  const apps = useQuery(api.clients.list, {});
  return (
    <>
      <PageHeading title="Apps">
        AI apps that use your accounts through Scope. Each app has its own
        rules. Apps never get your tokens.
      </PageHeading>
      <Section title="Add Scope to an app">
        <div className="space-y-4 px-6 py-5">
          <p className="leading-relaxed text-pretty text-scope-quiet">
            In ChatGPT, Claude, Cursor, Codex or another MCP app, add a custom
            MCP server or connector with this URL. The app opens a Scope
            sign-in. It appears below after its first request.
          </p>
          <CopyField label="Server URL" value={mcpUrl} />
        </div>
      </Section>
      <Section title="Connected apps">
        {apps === undefined ? (
          <ListSkeleton rows={2} />
        ) : apps.length ? (
          apps.map((app) => <AppRow key={app._id} app={app} />)
        ) : (
          <Empty>No apps yet. Add the URL above to an app to start.</Empty>
        )}
      </Section>
    </>
  );
}

function origin(clientKey: string) {
  try {
    return new URL(clientKey).hostname;
  } catch {
    return "Registered app";
  }
}

function AppRow({ app }: { app: App }) {
  const revoke = useMutation(api.clients.revoke),
    restore = useMutation(api.clients.restore);
  const [busy, setBusy] = useState(false);
  const revoked = app.revokedAt !== undefined;
  async function toggle() {
    setBusy(true);
    try {
      if (revoked) await restore({ id: app._id });
      else await revoke({ id: app._id });
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-4 px-6 py-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">
            {app.name}
            {revoked && (
              <span className="ml-2 text-xs font-normal text-red-700">
                Revoked
              </span>
            )}
          </h3>
          <p className="truncate text-xs text-scope-quiet">
            {origin(app.clientKey)}.{" "}
            {app.lastUsedAt
              ? `Last used ${formatTime(app.lastUsedAt)}`
              : "Not used yet"}
          </p>
        </div>
        <Button
          variant="ghost"
          className={revoked ? "text-scope-green" : "text-scope-quiet"}
          disabled={busy}
          onClick={() => void toggle()}
        >
          {busy && <Spinner />}
          {revoked ? "Allow again" : "Revoke"}
        </Button>
      </div>
      {revoked ? (
        <p className="text-xs text-scope-quiet">
          Every request from this app fails until you allow it again.
        </p>
      ) : (
        providers.map((providerId) => {
          const group = tools.filter((tool) => tool.providerId === providerId);
          const custom = group.filter((tool) => app.rules[tool.name]).length;
          return (
            <details key={providerId} className="group space-y-2">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-scope-quiet">
                <AppMark providerId={providerId} />
                {providerName(providerId)}
                <span className="font-normal">
                  {group.length} tools
                  {custom > 0 && `, ${custom} changed`}
                </span>
                <span className="ml-auto font-normal group-open:hidden">
                  Show rules
                </span>
                <span className="ml-auto hidden font-normal group-open:inline">
                  Hide rules
                </span>
              </summary>
              <ul className="divide-y divide-scope-line rounded-xl border border-scope-line">
                {group.map((tool) => (
                  <ToolRule
                    key={tool.name}
                    app={app}
                    tool={tool}
                    rule={app.rules[tool.name] ?? defaultRule(tool)}
                  />
                ))}
              </ul>
            </details>
          );
        })
      )}
    </article>
  );
}

function ToolRule({
  app,
  tool,
  rule,
}: {
  app: App;
  tool: ToolInfo;
  rule: Rule;
}) {
  const setRule = useMutation(api.clients.setRule);
  const [busy, setBusy] = useState<Rule>();
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        {tool.title}
        <span className="ml-2 text-xs text-scope-quiet">
          {tool.readOnly ? "reads" : "writes"}
        </span>
      </span>
      <div
        role="radiogroup"
        aria-label={`${tool.title} rule`}
        className="flex gap-1"
      >
        {(["allow", "ask", "block"] as const).map((value) => (
          <Button
            key={value}
            role="radio"
            aria-checked={rule === value}
            variant={rule === value ? "secondary" : "ghost"}
            size="xs"
            className="h-7 rounded-md"
            disabled={!!busy}
            onClick={() => {
              if (value === rule) return;
              setBusy(value);
              setRule({ id: app._id, tool: tool.name, rule: value })
                .catch(notify)
                .finally(() => setBusy(undefined));
            }}
          >
            {busy === value && <Spinner />}
            {ruleLabel[value]}
            {value === defaultRule(tool) && (
              <span className="sr-only"> (default)</span>
            )}
          </Button>
        ))}
      </div>
    </li>
  );
}
