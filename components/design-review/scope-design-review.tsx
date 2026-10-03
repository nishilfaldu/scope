"use client";

import { useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiChat02Icon,
  Plug01Icon,
  Notification01Icon,
  ShieldKeyIcon,
  ArrowDown01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  evidence,
  explanation,
  initialAccounts,
  initialAgents,
  outcome,
  sampleRequests,
  type ExampleAccount,
  type Moment,
} from "./sample-state";
import styles from "./scope-design-review.module.css";

type Screen = "Requests" | "Connections" | "Agents" | "Notifications";
type Modal =
  | { type: "connect"; app: "Airtable" | "Slack" }
  | { type: "stop-request"; id: string }
  | { type: "stop-account"; id: string }
  | { type: "agent"; id: "research" | "brief" }
  | { type: "permission" }
  | null;
const navigation = [
  { label: "Requests", icon: ShieldKeyIcon },
  { label: "Connections", icon: Plug01Icon },
  { label: "Agents", icon: AiChat02Icon },
  { label: "Notifications", icon: Notification01Icon },
] as const;

function AppMark({ app }: { app: "Airtable" | "Slack" }) {
  return (
    <span
      aria-hidden
      className={`${styles.appMark} ${app === "Slack" ? styles.slack : styles.airtable}`}
    >
      {app === "Slack" ? (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M8 3v12M16 9v12M3 8h12M9 16h12"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="m12 3 10 5-10 5L2 8l10-5ZM2 11l8 4v7l-8-4v-7Zm12 4 8-4v7l-8 4v-7Z" />
        </svg>
      )}
    </span>
  );
}

export function ScopeDesignReview() {
  const isMobile = useIsMobile();
  const [screen, setScreen] = useState<Screen>("Requests");
  const [requests, setRequests] = useState(sampleRequests);
  const [agents, setAgents] = useState(initialAgents);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [agentName, setAgentName] = useState("");
  const [notification, setNotification] = useState<
    "install" | "permission" | "enabled" | "blocked"
  >("install");
  const [notice, setNotice] = useState("");
  const [connectFailure, setConnectFailure] = useState(false);
  const pending = requests.filter(
    (r) => r.moment === "pending" && !r.stopped,
  ).length;
  const selectedRequest =
    modal?.type === "stop-request"
      ? requests.find((r) => r.id === modal.id)
      : undefined;
  const selectedAccount =
    modal?.type === "stop-account"
      ? accounts.find((a) => a.id === modal.id)
      : undefined;
  function navigate(next: Screen) {
    setScreen(next);
    setNotice("");
  }
  function decide(id: string, moment: "approved" | "denied") {
    setRequests((rows) =>
      rows.map((r) => (r.id === id ? { ...r, moment, when: "Just now" } : r)),
    );
    setNotice(
      moment === "approved"
        ? "Approved. Waiting for the agent to collect access."
        : "Denied. No access was shared.",
    );
  }
  function connect(app: "Airtable" | "Slack") {
    setConnectFailure(false);
    setModal({ type: "connect", app });
  }
  function completeConnection(app: "Airtable" | "Slack") {
    const added: ExampleAccount =
      app === "Airtable"
        ? {
            id: "personal",
            app,
            name: "Personal",
            identity: "maya.personal@example.com",
          }
        : { id: "bookclub", app, name: "Book club", identity: "Maya Chen" };
    setAccounts((rows) => [...rows.filter((a) => a.id !== added.id), added]);
    setModal(null);
    setNotice(
      `${added.name} connected. Agent access still needs your approval.`,
    );
  }
  function reset() {
    setRequests(sampleRequests);
    setAgents(initialAgents);
    setAccounts(initialAccounts);
    setNotification("install");
    setExpanded(null);
    setNotice("");
    setScreen("Requests");
  }
  return (
    <div className={styles.review}>
      <div className={styles.reviewBar}>
        <span>Design preview. Sample data only.</span>
        <Link href="/approvals">Open working app</Link>
      </div>
      <div className={styles.workspace}>
        <aside className={styles.rail}>
          <div className={styles.brand}>
            <BrandMark className="size-7" />
            <span>Scope</span>
          </div>
          <nav
            aria-label="Scope preview navigation"
            className={styles.navigation}
          >
            {navigation.map(({ label, icon }) => (
              <button
                key={label}
                aria-current={screen === label ? "page" : undefined}
                onClick={() => navigate(label)}
              >
                <HugeiconsIcon icon={icon} size={20} strokeWidth={1.7} />
                <span>{label}</span>
                {label === "Requests" && pending > 0 && (
                  <span className={styles.navCount}>{pending}</span>
                )}
              </button>
            ))}
          </nav>
        </aside>
        <main className={styles.main}>
          <header className={styles.pageHeading}>
            <h1>{screen}</h1>
            <p>
              {screen === "Requests"
                ? pending
                  ? `${pending} request${pending === 1 ? " needs" : "s need"} your decision.`
                  : "No requests need your approval."
                : screen === "Connections"
                  ? "Choose the accounts your agents can ask to use."
                  : screen === "Agents"
                    ? "Recognize who's asking before you approve."
                    : "Know when an agent needs your decision."}
            </p>
          </header>
          <div
            role="status"
            aria-live="polite"
            className={
              notice && screen !== "Requests" ? styles.notice : styles.srOnly
            }
          >
            {notice}
          </div>
          {screen === "Requests" && (
            <>
              <div className={styles.requestList} aria-label="Access requests">
                {requests.map((r) => {
                  const agent = agents[r.agent],
                    isPending = r.moment === "pending" && !r.stopped,
                    isOpen = expanded === r.id;
                  const needsExplanation =
                    ["unconfirmed", "unused"].includes(r.moment) && !r.stopped;
                  return (
                    <article
                      key={r.id}
                      className={`${styles.request} ${isPending ? styles.pending : ""}`}
                      aria-label={`${agent.name}: ${r.access}`}
                    >
                      <div className={styles.requestHead}>
                        <button
                          className={styles.requestSummary}
                          aria-expanded={isOpen}
                          aria-controls={`detail-${r.id}`}
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                        >
                          <span className={styles.avatar}>
                            {agent.initials}
                          </span>
                          <span className={styles.who}>
                            <strong>{agent.name}</strong>
                            <span>{agent.source}</span>
                          </span>
                          <span className={styles.summaryEnd}>
                            <time>
                              {isPending ? "25 min to decide" : r.when}
                            </time>
                            <HugeiconsIcon
                              className={isOpen ? styles.rotated : ""}
                              icon={ArrowDown01Icon}
                              size={16}
                            />
                          </span>
                        </button>
                        <div className={styles.requestBody}>
                          <div className={styles.access}>
                            <AppMark app={r.app} />
                            <div>
                              <p>{r.access}</p>
                              <span>
                                {r.app} / {r.account}
                              </span>
                              {isPending && (
                                <p className={styles.permission}>
                                  {r.boundary}
                                </p>
                              )}
                            </div>
                          </div>
                          {isPending ? (
                            <div className={styles.decision}>
                              <Button
                                className={styles.approve}
                                onClick={() => decide(r.id, "approved")}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="outline"
                                className={styles.deny}
                                onClick={() => decide(r.id, "denied")}
                              >
                                Deny
                              </Button>
                            </div>
                          ) : (
                            <button
                              className={`${styles.outcome} ${needsExplanation ? styles.attention : ""}`}
                              onClick={() => setExpanded(isOpen ? null : r.id)}
                              aria-expanded={isOpen}
                              aria-controls={`detail-${r.id}`}
                            >
                              {r.moment === "received" && !r.stopped && (
                                <HugeiconsIcon icon={Tick02Icon} size={14} />
                              )}
                              {outcome(r)}
                              {needsExplanation && <span aria-hidden>?</span>}
                            </button>
                          )}
                        </div>
                      </div>
                      {isOpen && (
                        <div
                          id={`detail-${r.id}`}
                          className={styles.requestDetail}
                        >
                          <p className={styles.explanation}>
                            {explanation(r, agent.name)}
                          </p>
                          {!isPending && (
                            <ol
                              aria-label="What happened"
                              className={styles.evidence}
                            >
                              {evidence(r).map((item, i, all) => (
                                <li
                                  key={item}
                                  className={
                                    i === all.length - 1
                                      ? `${styles.latest} ${needsExplanation ? styles.attention : ""}`
                                      : ""
                                  }
                                >
                                  <span aria-hidden />
                                  {item}
                                </li>
                              ))}
                            </ol>
                          )}
                          {isPending && (
                            <p className={styles.detailNote}>
                              This request comes from the connection you named “
                              {agent.name}.”
                            </p>
                          )}
                          {needsExplanation && (
                            <p className={styles.nextStep}>
                              {r.moment === "unconfirmed"
                                ? "Check with the agent before asking it to try again."
                                : "Ask the agent to request access again if you still want it to continue."}
                            </p>
                          )}
                          {!r.stopped &&
                            ["approved", "received"].includes(r.moment) && (
                              <button
                                className={styles.textAction}
                                onClick={() =>
                                  setModal({ type: "stop-request", id: r.id })
                                }
                              >
                                Stop further sharing
                              </button>
                            )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
              <p className={styles.endNote}>That’s everything for now.</p>
            </>
          )}
          {screen === "Connections" && (
            <div className={styles.connectionList}>
              {(["Airtable", "Slack"] as const).map((app) => (
                <section key={app} className={styles.appGroup}>
                  <header>
                    <AppMark app={app} />
                    <h2>{app}</h2>
                    <Button
                      variant="ghost"
                      className={styles.addAccount}
                      onClick={() => connect(app)}
                    >
                      Connect account
                    </Button>
                  </header>
                  {accounts
                    .filter((a) => a.app === app)
                    .map((a) => (
                      <div className={styles.account} key={a.id}>
                        <div>
                          <h3>{a.name}</h3>
                          <p>{a.identity}</p>
                          {a.stopped && (
                            <p className={styles.attention}>Sharing stopped</p>
                          )}
                        </div>
                        <button
                          className={styles.textAction}
                          onClick={() =>
                            setModal({ type: "stop-account", id: a.id })
                          }
                        >
                          {a.stopped ? "View" : "Manage"}
                        </button>
                      </div>
                    ))}
                </section>
              ))}
              <p className={styles.connectionNote}>
                Connecting an account makes it available for requests.
                <br />
                You still decide each time an agent asks for access.
              </p>
            </div>
          )}
          {screen === "Agents" && (
            <div className={styles.agentList}>
              {(Object.keys(agents) as (keyof typeof agents)[]).map((id) => (
                <article className={styles.agent} key={id}>
                  <span className={styles.avatar}>{agents[id].initials}</span>
                  <div>
                    <h2>{agents[id].name}</h2>
                    <p>{agents[id].source}</p>
                    <span>Connected by you</span>
                  </div>
                  <button
                    className={styles.textAction}
                    onClick={() => {
                      setAgentName(agents[id].name);
                      setModal({ type: "agent", id });
                    }}
                  >
                    Edit name
                  </button>
                </article>
              ))}
              <p className={styles.connectionNote}>
                A name helps you recognize a connection. More than one chat may
                use the same connection.
              </p>
            </div>
          )}
          {screen === "Notifications" && (
            <section className={styles.notificationSetup}>
              {isMobile && (
                <div className={styles.phoneIllustration} aria-hidden>
                  <div>
                    <BrandMark className="size-6" />
                    <span>
                      Scope<strong>Studio research needs access</strong>
                    </span>
                  </div>
                </div>
              )}
              <h2>
                {notification === "enabled"
                  ? "You're ready for the next request"
                  : notification === "blocked"
                    ? "Notifications are turned off"
                    : notification === "permission"
                      ? "Allow alerts from Scope"
                      : isMobile
                        ? "Take Scope with you"
                        : "Alerts in this browser"}
              </h2>
              <p>
                {notification === "enabled"
                  ? "Scope will alert you when an agent asks for access. Open the request to decide."
                  : notification === "blocked"
                    ? "You can still review every request here. To receive alerts, allow notifications for Scope in your device settings."
                    : notification === "permission"
                      ? "Get an alert when an agent needs your approval. You can change this in your device settings."
                      : isMobile
                        ? "On iPhone, add Scope to your Home Screen so access requests can reach you."
                        : "Get an alert when an agent needs your approval, even when you’re doing something else."}
              </p>
              {notification === "install" && isMobile && (
                <>
                  <ol className={styles.installSteps}>
                    <li>
                      <span>1</span>Open Scope in Safari.
                    </li>
                    <li>
                      <span>2</span>Tap Share, then Add to Home Screen.
                    </li>
                    <li>
                      <span>3</span>Open Scope from your Home Screen.
                    </li>
                  </ol>
                  <Button
                    className={styles.approve}
                    onClick={() => setNotification("permission")}
                  >
                    I’ve added Scope
                  </Button>
                </>
              )}
              {(notification === "permission" ||
                (notification === "install" && !isMobile)) && (
                <Button
                  className={styles.approve}
                  onClick={() => setModal({ type: "permission" })}
                >
                  Enable notifications
                </Button>
              )}
              {(notification === "enabled" || notification === "blocked") && (
                <Button variant="outline" onClick={() => navigate("Requests")}>
                  Back to requests
                </Button>
              )}
            </section>
          )}
          <details className={styles.reviewControls}>
            <summary>Try the design</summary>
            <div>
              <p>
                These controls change sample data only. Refresh to start again.
              </p>
              <label htmlFor="sample-moment">First request</label>
              <select
                id="sample-moment"
                value={requests[0].moment}
                onChange={(e) => {
                  const moment = e.target.value as Moment;
                  setRequests((rows) =>
                    rows.map((r, i) =>
                      i === 0
                        ? { ...r, moment, stopped: false, when: "Just now" }
                        : r,
                    ),
                  );
                  setScreen("Requests");
                  setExpanded("launch");
                  setNotice("");
                }}
              >
                <option value="pending">Waiting for my decision</option>
                <option value="approved">Approved, waiting for agent</option>
                <option value="received">Agent confirmed receipt</option>
                <option value="unconfirmed">Receipt never confirmed</option>
                <option value="unused">Approved but not collected</option>
                <option value="denied">Denied</option>
              </select>
              <button className={styles.textAction} onClick={reset}>
                Reset all examples
              </button>
            </div>
          </details>
        </main>
      </div>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <DialogContent className={styles.dialog}>
          {modal?.type === "connect" && (
            <>
              <DialogHeader>
                <AppMark app={modal.app} />
                <DialogTitle>Connect {modal.app}</DialogTitle>
                <DialogDescription>
                  Sign in to choose an account. Your account appears in Scope
                  only after you finish.
                </DialogDescription>
              </DialogHeader>
              <div className={styles.examplePrompt}>
                <p>Example provider sign-in</p>
                <strong>
                  {modal.app === "Airtable" ? "Personal" : "Book club"}
                </strong>
                <span>
                  {modal.app === "Airtable"
                    ? "maya.personal@example.com"
                    : "Maya Chen"}
                </span>
              </div>
              {connectFailure && (
                <p role="alert" className={styles.failure}>
                  Sign-in didn’t finish. No account was added. Try again when
                  you’re ready.
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setModal(null)}>
                  Cancel
                </Button>
                <Button
                  className={styles.approve}
                  onClick={() => completeConnection(modal.app)}
                >
                  Finish example sign-in
                </Button>
              </DialogFooter>
              <button
                className={styles.textAction}
                onClick={() => setConnectFailure(true)}
              >
                Try a failed sign-in
              </button>
            </>
          )}
          {modal?.type === "stop-request" && selectedRequest && (
            <>
              <DialogHeader>
                <DialogTitle>Stop further sharing?</DialogTitle>
                <DialogDescription>
                  Scope will not send access again for this request. Access
                  already received by the agent is unaffected.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setModal(null)}>
                  Keep sharing
                </Button>
                <Button
                  className={styles.approve}
                  onClick={() => {
                    setRequests((rows) =>
                      rows.map((r) =>
                        r.id === selectedRequest.id
                          ? { ...r, stopped: true, when: "Just now" }
                          : r,
                      ),
                    );
                    setModal(null);
                    setNotice("Further sharing stopped for this request.");
                  }}
                >
                  Stop sharing
                </Button>
              </DialogFooter>
            </>
          )}
          {modal?.type === "stop-account" && selectedAccount && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedAccount.name}</DialogTitle>
                <DialogDescription>
                  {selectedAccount.stopped
                    ? "Scope is no longer sharing this account with agents."
                    : "Stop Scope from sharing access from this account with agents."}{" "}
                  Access already received may still work. To revoke that access,
                  use your {selectedAccount.app} account settings.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setModal(null)}>
                  Close
                </Button>
                {!selectedAccount.stopped && (
                  <Button
                    className={styles.approve}
                    onClick={() => {
                      setAccounts((rows) =>
                        rows.map((a) =>
                          a.id === selectedAccount.id
                            ? { ...a, stopped: true }
                            : a,
                        ),
                      );
                      setRequests((rows) =>
                        rows.map((r) =>
                          r.app === selectedAccount.app &&
                          r.account === selectedAccount.name &&
                          r.moment !== "denied"
                            ? { ...r, stopped: true }
                            : r,
                        ),
                      );
                      setModal(null);
                      setNotice(
                        `Further sharing from ${selectedAccount.name} stopped.`,
                      );
                    }}
                  >
                    Stop sharing
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
          {modal?.type === "agent" && (
            <>
              <DialogHeader>
                <DialogTitle>A name you’ll recognize</DialogTitle>
                <DialogDescription>
                  {agents[modal.id].source}. Requests from this connection share
                  this name.
                </DialogDescription>
              </DialogHeader>
              <label htmlFor="review-agent-name">
                Agent name
                <Input
                  id="review-agent-name"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  maxLength={60}
                  className="mt-2"
                />
              </label>
              <DialogFooter>
                <Button variant="outline" onClick={() => setModal(null)}>
                  Cancel
                </Button>
                <Button
                  className={styles.approve}
                  disabled={!agentName.trim()}
                  onClick={() => {
                    setAgents((rows) => ({
                      ...rows,
                      [modal.id]: {
                        ...rows[modal.id],
                        name: agentName.trim(),
                        initials: agentName
                          .trim()
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((s) => s[0])
                          .join("")
                          .toUpperCase(),
                      },
                    }));
                    setModal(null);
                    setNotice("Agent name updated across your requests.");
                  }}
                >
                  Save name
                </Button>
              </DialogFooter>
            </>
          )}
          {modal?.type === "permission" && (
            <>
              <DialogHeader>
                <DialogTitle>Example notification permission</DialogTitle>
                <DialogDescription>
                  This preview does not change your browser permissions. Try
                  either choice to see what comes next.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setNotification("blocked");
                    setModal(null);
                  }}
                >
                  Don’t allow
                </Button>
                <Button
                  className={styles.approve}
                  onClick={() => {
                    setNotification("enabled");
                    setModal(null);
                  }}
                >
                  Allow example alerts
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
