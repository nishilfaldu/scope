export type Moment =
  "pending" | "approved" | "received" | "unconfirmed" | "unused" | "denied";
export type ExampleRequest = {
  id: string;
  agent: "research" | "brief";
  app: "Airtable" | "Slack";
  account: string;
  access: string;
  boundary: string;
  moment: Moment;
  when: string;
  stopped?: boolean;
};
export const sampleRequests: ExampleRequest[] = [
  {
    id: "launch",
    agent: "research",
    app: "Airtable",
    account: "Northstar studio",
    access: "Read records in Launch plan",
    boundary: "Read-only access to this base. Cannot edit or delete records.",
    moment: "pending",
    when: "Just now",
  },
  {
    id: "brief",
    agent: "brief",
    app: "Slack",
    account: "Northstar",
    access: "Read messages in #team-updates",
    boundary: "Read-only access to this channel. Cannot send messages.",
    moment: "unconfirmed",
    when: "35 min ago",
  },
  {
    id: "research",
    agent: "research",
    app: "Airtable",
    account: "Northstar studio",
    access: "Read records in Research notes",
    boundary: "Read-only access to this base. Cannot edit or delete records.",
    moment: "received",
    when: "1 hour ago",
  },
  {
    id: "personal",
    agent: "brief",
    app: "Airtable",
    account: "Personal",
    access: "Read records in Reading list",
    boundary: "Read-only access to this base. Cannot edit or delete records.",
    moment: "denied",
    when: "Yesterday",
  },
  {
    id: "unused",
    agent: "research",
    app: "Airtable",
    account: "Northstar studio",
    access: "Read records in Launch plan",
    boundary: "Read-only access to this base. Cannot edit or delete records.",
    moment: "unused",
    when: "Yesterday",
  },
];
export const initialAgents = {
  research: {
    name: "Studio research",
    source: "Codex on your Mac",
    initials: "SR",
  },
  brief: { name: "Weekly brief", source: "Claude Desktop", initials: "WB" },
};
export type ExampleAccount = {
  id: string;
  app: "Airtable" | "Slack";
  name: string;
  identity: string;
  stopped?: boolean;
};
export const initialAccounts: ExampleAccount[] = [
  {
    id: "studio",
    app: "Airtable",
    name: "Northstar studio",
    identity: "maya@example.com",
  },
  { id: "northstar", app: "Slack", name: "Northstar", identity: "Maya Chen" },
];
export function outcome(r: ExampleRequest) {
  if (r.stopped) return "Further sharing stopped";
  return {
    pending: "Needs your approval",
    approved: "Waiting for the agent",
    received: "Access received",
    unconfirmed: "Receipt not confirmed",
    unused: "Approval expired unused",
    denied: "Denied by you",
  }[r.moment];
}
export function explanation(r: ExampleRequest, name: string) {
  if (r.stopped)
    return r.moment === "received"
      ? "Scope will not send access again. Access already received by the agent is unaffected."
      : "Scope will not send access for this request. No receipt was confirmed.";
  return {
    pending: "Approve only if you recognize this agent and account.",
    approved: `You approved this request. ${name} has not collected access yet.`,
    received: `${name} confirmed receiving the access you approved.`,
    unconfirmed:
      "Scope tried to send access, but the agent did not confirm receiving it before the sharing window closed.",
    unused:
      "You approved this request, but the agent did not collect access before the sharing window closed.",
    denied: "You declined this request. Scope did not share access.",
  }[r.moment];
}
export function evidence(r: ExampleRequest) {
  const items = ["Requested"];
  if (r.moment === "denied") items.push("Denied");
  else if (r.moment !== "pending") items.push("Approved");
  if (r.moment === "received") items.push("Received");
  if (r.moment === "unconfirmed") items.push("Unconfirmed");
  if (r.moment === "unused") items.push("Window closed");
  if (r.stopped) items.push("Sharing stopped");
  return items;
}
