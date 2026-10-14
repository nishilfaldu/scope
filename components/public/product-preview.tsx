"use client";

import { useState, type ReactNode } from "react";
import {
  Activity01Icon,
  DashboardSquare01Icon,
  Notification01Icon,
  Plug01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { AppMark } from "@/components/shared/app-mark";
import { BrandMark } from "@/components/shared/brand-mark";
import { cn } from "@/lib/utils";
import { ruleLabel, type Rule } from "@/shared/tools";

type Screen = "Requests" | "Apps" | "Activity" | "Accounts" | "Notifications";
type Duration = 0 | 15 | 30 | 60;
type Outcome =
  | { kind: "pending" }
  | { kind: "approved"; minutes: Duration; by: "you" | "rule" }
  | { kind: "denied"; by: "you" | "rule" }
  | { kind: "ended" };

const nav: { label: Screen; icon: typeof ShieldKeyIcon }[] = [
  { label: "Requests", icon: ShieldKeyIcon },
  { label: "Apps", icon: DashboardSquare01Icon },
  { label: "Activity", icon: Activity01Icon },
  { label: "Accounts", icon: Plug01Icon },
  { label: "Notifications", icon: Notification01Icon },
];

const durations: { value: Duration; label: string }[] = [
  { value: 0, label: "This call only" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];

const providers = [
  { id: "github", name: "GitHub", label: "acme" },
  { id: "google", name: "Google", label: "Connected" },
  { id: "notion", name: "Notion", label: "Connected" },
  { id: "vercel", name: "Vercel", label: "Connected" },
];

function durationText(minutes: Duration) {
  if (minutes === 0) return "this call only";
  if (minutes === 60) return "1 hour";
  return `${minutes} minutes`;
}

function activityText(outcome: Outcome) {
  if (outcome.kind === "pending") return "Asked you";
  if (outcome.kind === "ended") return "Ended";
  if (outcome.kind === "approved" && outcome.by === "rule")
    return "Allowed by rule and ran";
  if (outcome.kind === "approved") return "Approved by you and ran";
  if (outcome.by === "rule") return "Blocked by rule";
  return "Denied by you";
}

export function ProductPreview() {
  const [screen, setScreen] = useState<Screen>("Requests");
  const [minutes, setMinutes] = useState<Duration>(0);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "pending" });
  const [sendRule, setSendRule] = useState<Rule>("ask");
  const [readRule, setReadRule] = useState<Rule>("allow");
  const [connected, setConnected] = useState<string[]>(["github"]);
  const github = connected.includes("github");
  const pending = outcome.kind === "pending";

  function approve() {
    if (!github) return;
    setOutcome({ kind: "approved", minutes, by: "you" });
    setScreen("Requests");
  }

  function deny() {
    setOutcome({ kind: "denied", by: "you" });
    setScreen("Requests");
  }

  function chooseSendRule(rule: Rule) {
    setSendRule(rule);
    setOutcome((current) => {
      const fromRule =
        current.kind === "approved" || current.kind === "denied"
          ? current.by === "rule"
          : false;
      if (current.kind !== "pending" && !fromRule) return current;
      if (rule === "ask") return { kind: "pending" };
      if (rule === "allow") return { kind: "approved", minutes: 0, by: "rule" };
      return { kind: "denied", by: "rule" };
    });
  }

  function replay() {
    setSendRule("ask");
    setMinutes(0);
    setOutcome({ kind: "pending" });
    setConnected((current) =>
      current.includes("github") ? current : ["github", ...current],
    );
    setScreen("Requests");
  }

  return (
    <section
      aria-label="Scope preview"
      className="overflow-hidden rounded-2xl border border-scope-line bg-scope-wash text-left text-sm text-scope-ink"
    >
      <nav
        aria-label="Preview"
        className="flex gap-1 overflow-x-auto border-b border-scope-line px-3 py-2 sm:hidden"
      >
        <PreviewNav screen={screen} pending={pending} onSelect={setScreen} />
      </nav>
      <div className="flex">
        <aside className="hidden w-[200px] shrink-0 flex-col border-r border-scope-line px-4 py-6 sm:flex">
          <nav aria-label="Preview" className="flex flex-col gap-1">
            <PreviewNav
              screen={screen}
              pending={pending}
              onSelect={setScreen}
            />
          </nav>
        </aside>
        <div className="min-w-0 flex-1 px-5 py-6 sm:px-8">
          <p className="sr-only" aria-live="polite">
            {screen}. {activityText(outcome)}.
          </p>
          {screen === "Requests" && (
            <RequestsView
              outcome={outcome}
              minutes={minutes}
              github={github}
              onMinutes={setMinutes}
              onApprove={approve}
              onDeny={deny}
              onEnd={() => setOutcome({ kind: "ended" })}
              onConnectGitHub={() =>
                setConnected((current) =>
                  current.includes("github") ? current : ["github", ...current],
                )
              }
              onNotifications={() => setScreen("Notifications")}
              onReplay={replay}
            />
          )}
          {screen === "Apps" && (
            <AppsView
              sendRule={sendRule}
              readRule={readRule}
              onSendRule={chooseSendRule}
              onReadRule={setReadRule}
            />
          )}
          {screen === "Activity" && <ActivityView outcome={outcome} />}
          {screen === "Accounts" && (
            <AccountsView
              connected={connected}
              onToggle={(id) =>
                setConnected((current) =>
                  current.includes(id)
                    ? current.filter((item) => item !== id)
                    : [...current, id],
                )
              }
            />
          )}
          {screen === "Notifications" && (
            <NotificationsView
              pending={pending}
              onOpen={() => setScreen("Requests")}
              onApprove={approve}
              onDeny={deny}
              onReplay={replay}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function PreviewNav({
  screen,
  pending,
  onSelect,
}: {
  screen: Screen;
  pending: boolean;
  onSelect: (screen: Screen) => void;
}) {
  return (
    <>
      {nav.map((item) => (
        <button
          key={item.label}
          type="button"
          aria-current={screen === item.label ? "page" : undefined}
          onClick={() => onSelect(item.label)}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-2 whitespace-nowrap hover:bg-scope-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
            screen === item.label && "bg-scope-hover font-medium",
          )}
        >
          <HugeiconsIcon icon={item.icon} size={18} strokeWidth={1.7} />
          {item.label}
          {item.label === "Requests" && pending && (
            <span className="ml-auto min-w-5 rounded-full bg-scope-green px-1.5 text-center text-[11px] leading-5 font-medium text-white">
              1<span className="sr-only"> waiting</span>
            </span>
          )}
        </button>
      ))}
    </>
  );
}

function RequestsView({
  outcome,
  minutes,
  github,
  onMinutes,
  onApprove,
  onDeny,
  onEnd,
  onConnectGitHub,
  onNotifications,
  onReplay,
}: {
  outcome: Outcome;
  minutes: Duration;
  github: boolean;
  onMinutes: (minutes: Duration) => void;
  onApprove: () => void;
  onDeny: () => void;
  onEnd: () => void;
  onConnectGitHub: () => void;
  onNotifications: () => void;
  onReplay: () => void;
}) {
  return (
    <>
      <h2 className="text-[22px] leading-tight font-[550] tracking-[-0.6px]">
        Requests
      </h2>
      <p className="mt-2 text-scope-quiet">
        {outcome.kind === "pending"
          ? "1 request needs your decision."
          : "No requests need your decision."}
      </p>
      {outcome.kind === "pending" ? (
        <>
          <p className="mt-6 mb-3 font-semibold">Needs approval</p>
          <article className="rounded-2xl border border-scope-line bg-white px-5 py-5">
            <RequestSummary />
            {github ? (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div
                  role="group"
                  aria-label="Approve for"
                  className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
                >
                  {durations.map((item) => (
                    <Choice
                      key={item.value}
                      pressed={minutes === item.value}
                      onClick={() => onMinutes(item.value)}
                    >
                      {item.label}
                    </Choice>
                  ))}
                </div>
                <div className="flex gap-2 sm:ml-auto">
                  <Action onClick={onApprove}>Approve</Action>
                  <Choice onClick={onDeny}>Deny</Choice>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-scope-quiet">
                <button
                  type="button"
                  className="text-scope-green underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                  onClick={onConnectGitHub}
                >
                  Connect a GitHub account
                </button>{" "}
                to approve this request.
              </p>
            )}
          </article>
          <button
            type="button"
            className="mt-4 text-scope-green hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            onClick={onNotifications}
          >
            Also sent to your phone and browser
          </button>
        </>
      ) : (
        <div className="mt-8">
          {outcome.kind === "approved" && outcome.by === "you" ? (
            <>
              <p className="mb-3 font-semibold">Active approvals</p>
              <article className="rounded-2xl border border-scope-line bg-white px-5 py-5">
                <RequestSummary />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-xs text-scope-quiet">
                    Approved for {durationText(outcome.minutes)}
                  </p>
                  <button
                    type="button"
                    className="ml-auto rounded-lg px-3 py-2 text-scope-green hover:bg-scope-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                    onClick={onEnd}
                  >
                    End approval
                  </button>
                </div>
              </article>
            </>
          ) : (
            <p className="text-scope-quiet">
              {outcome.kind === "approved"
                ? "Merge a pull request is allowed, so Scope did not ask."
                : outcome.kind === "denied" && outcome.by === "rule"
                  ? "Merge a pull request is blocked, so Scope refused the call."
                  : outcome.kind === "denied"
                    ? "You denied this call."
                    : "You ended the approval."}
            </p>
          )}
          <button
            type="button"
            className="mt-4 text-scope-green hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            onClick={onReplay}
          >
            Replay this request
          </button>
        </div>
      )}
    </>
  );
}

function RequestSummary() {
  return (
    <div className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-scope-hover text-xs font-semibold text-scope-green">
        C
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <strong className="font-medium">Cursor</strong>
          <span className="text-scope-quiet">wants</span>
          <AppMark providerId="github" />
          <span>GitHub: Merge a pull request</span>
          <span className="text-scope-quiet">in acme/web</span>
        </p>
        <p className="mt-2 leading-relaxed">
          Merge #128 &quot;Release 2.0&quot; into main
        </p>
      </div>
    </div>
  );
}

function AppsView({
  sendRule,
  readRule,
  onSendRule,
  onReadRule,
}: {
  sendRule: Rule;
  readRule: Rule;
  onSendRule: (rule: Rule) => void;
  onReadRule: (rule: Rule) => void;
}) {
  return (
    <>
      <h2 className="text-[22px] leading-tight font-[550] tracking-[-0.6px]">
        Apps
      </h2>
      <p className="mt-2 text-scope-quiet">
        Each app has its own rules. Change the Merge a pull request rule, then
        open Requests.
      </p>
      <article className="mt-8 rounded-2xl border border-scope-line bg-white px-5 py-5">
        <h3 className="font-medium">Cursor</h3>
        <p className="mt-1 text-xs text-scope-quiet">Example app</p>
        <div className="mt-4 flex items-center gap-2 text-xs font-medium text-scope-quiet">
          <AppMark providerId="github" />
          GitHub
        </div>
        <ul className="mt-3 divide-y divide-scope-line rounded-xl border border-scope-line">
          <RuleRow
            title="Read a pull request"
            hint="reads"
            rule={readRule}
            onChange={onReadRule}
          />
          <RuleRow
            title="Merge a pull request"
            hint="writes"
            rule={sendRule}
            onChange={onSendRule}
          />
        </ul>
      </article>
    </>
  );
}

function RuleRow({
  title,
  hint,
  rule,
  onChange,
}: {
  title: string;
  hint: string;
  rule: Rule;
  onChange: (rule: Rule) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        {title}
        <span className="ml-2 text-xs text-scope-quiet">{hint}</span>
      </span>
      <div
        role="radiogroup"
        aria-label={`${title} rule`}
        className="flex gap-1"
      >
        {(["allow", "ask", "block"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rule === value}
            onClick={() => onChange(value)}
            className={cn(
              "h-7 rounded-md px-2.5 text-xs focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
              rule === value
                ? "bg-secondary font-medium"
                : "hover:bg-scope-hover",
            )}
          >
            {ruleLabel[value]}
          </button>
        ))}
      </div>
    </li>
  );
}

function ActivityView({ outcome }: { outcome: Outcome }) {
  return (
    <>
      <h2 className="text-[22px] leading-tight font-[550] tracking-[-0.6px]">
        Activity
      </h2>
      <p className="mt-2 text-scope-quiet">
        Every tool call. Scope does not store arguments or results.
      </p>
      <div className="mt-8 divide-y divide-scope-line overflow-hidden rounded-2xl border border-scope-line bg-white">
        <ActivityRow
          title="Merge a pull request"
          detail={activityText(outcome)}
          failed={outcome.kind === "denied"}
        />
        <ActivityRow
          title="Read a pull request"
          detail="Allowed by rule and ran"
        />
      </div>
    </>
  );
}

function ActivityRow({
  title,
  detail,
  failed = false,
}: {
  title: string;
  detail: string;
  failed?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <AppMark providerId="github" />
      <div className="min-w-0 flex-1">
        <p>
          <span className="font-medium">{title}</span>{" "}
          <span className="text-scope-quiet">from Cursor</span>
        </p>
        <p
          className={cn(
            "text-xs",
            failed ? "text-red-700" : "text-scope-quiet",
          )}
        >
          {detail}
        </p>
      </div>
    </div>
  );
}

function AccountsView({
  connected,
  onToggle,
}: {
  connected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <>
      <h2 className="text-[22px] leading-tight font-[550] tracking-[-0.6px]">
        Accounts
      </h2>
      <p className="mt-2 text-scope-quiet">
        Scope runs tool calls with these accounts. One account per provider.
      </p>
      <div className="mt-8 divide-y divide-scope-line overflow-hidden rounded-2xl border border-scope-line bg-white">
        {providers.map((provider) => {
          const on = connected.includes(provider.id);
          return (
            <div
              key={provider.id}
              className="flex items-center gap-3 px-5 py-4"
            >
              <AppMark providerId={provider.id} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{provider.name}</p>
                <p className="text-xs text-scope-quiet">
                  {on ? provider.label : "Not connected"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onToggle(provider.id)}
                className={cn(
                  "rounded-lg px-3 py-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                  on
                    ? "text-scope-quiet hover:bg-scope-hover"
                    : "text-scope-green hover:bg-scope-hover",
                )}
              >
                {on ? "Disconnect" : "Connect"}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function NotificationsView({
  pending,
  onOpen,
  onApprove,
  onDeny,
  onReplay,
}: {
  pending: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onDeny: () => void;
  onReplay: () => void;
}) {
  return (
    <>
      <h2 className="text-[22px] leading-tight font-[550] tracking-[-0.6px]">
        Notifications
      </h2>
      <p className="mt-2 max-w-xl text-scope-quiet">
        Get a notification on this device when an app asks to run a tool. On
        iPhone, add Scope to your Home Screen first.
      </p>
      {pending ? (
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="font-medium">On your phone</h3>
            <p className="mt-1 text-scope-quiet">
              The notification opens the request.
            </p>
            <button
              type="button"
              onClick={onOpen}
              className="mt-3 w-full rounded-2xl border border-scope-line bg-white p-4 text-left hover:bg-scope-hover/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <NoticeBody />
            </button>
          </div>
          <div>
            <h3 className="font-medium">In your browser</h3>
            <p className="mt-1 text-scope-quiet">
              Approve or deny from the notification.
            </p>
            <div className="mt-3 rounded-2xl border border-scope-line bg-white p-4">
              <NoticeBody />
              <div className="mt-4 flex gap-2">
                <Action onClick={onApprove}>Approve</Action>
                <Choice onClick={onDeny}>Deny</Choice>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <p className="text-scope-quiet">No requests waiting.</p>
          <button
            type="button"
            className="mt-4 text-scope-green hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            onClick={onReplay}
          >
            Replay this request
          </button>
        </div>
      )}
    </>
  );
}

function NoticeBody() {
  return (
    <span className="flex items-start gap-3">
      <BrandMark className="size-8" />
      <span>
        <span className="block text-xs text-scope-quiet">Scope</span>
        <span className="block font-medium">An app needs your approval</span>
        <span className="mt-1 block text-scope-quiet">
          Cursor wants GitHub: Merge a pull request
        </span>
      </span>
    </span>
  );
}

function Choice({
  pressed,
  children,
  onClick,
}: {
  pressed?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-xs focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        pressed
          ? "border-transparent bg-secondary font-medium"
          : "border-scope-line bg-white hover:bg-scope-hover",
      )}
    >
      {children}
    </button>
  );
}

function Action({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center rounded-lg bg-scope-green px-3 text-xs font-medium text-white hover:bg-scope-green-dark focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      {children}
    </button>
  );
}
