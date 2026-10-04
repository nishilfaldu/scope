import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const deployment = "bright-dinosaur-692";
const prefix = "scope-ui-review-v1";
const minutes = 60_000;

export function reviewRequests(ownerId, bindings, now = Date.now()) {
  const names = {
    research: "Demo · Research assistant",
    release: "Demo · Release coordinator",
    long: "Demo · Weekly digest assistant for engineering and customer success",
    stopped: "Demo · Stopped assistant",
  };
  const labels = {
    active: "Demo · Maya (Design workspace)",
    long: "Demo · Jordan (Platform engineering and customer operations)",
    disconnected: "Demo · Archived workspace",
  };
  const scenarios = [
    {
      key: "approve",
      reason: "Summarize the latest messages in #design-reviews.",
      age: 1,
    },
    {
      key: "deny",
      reason: "Draft a release update from #launch-readiness.",
      age: 2,
      agent: "release",
    },
    {
      key: "long-reason",
      reason:
        "Compare the discussion in #customer-feedback with the launch checklist, identify unresolved questions, and prepare a short handoff for the engineering and customer success teams. Include channel names and the owners mentioned in the discussion so I can review the follow-up before anything is sent.",
      age: 3,
      account: "long",
      agent: "long",
      longCommand: true,
    },
    {
      key: "pickup",
      reason: "Create an index of public project channels.",
      age: 8,
      status: "approved",
    },
    {
      key: "receipt",
      reason: "Prepare the release channel list.",
      age: 11,
      status: "approved",
      delivered: true,
      agent: "release",
    },
    {
      key: "received",
      reason: "Prepare the weekly design digest.",
      age: 15,
      status: "approved",
      delivered: true,
      received: true,
    },
    {
      key: "denied",
      reason: "Summarize project discussions for the report.",
      age: 35,
      status: "denied",
    },
    {
      key: "expired",
      reason: "Gather notes for the planning meeting.",
      age: 70,
    },
    {
      key: "not-collected",
      reason: "Collect public channels for the project handbook.",
      age: 80,
      status: "approved",
    },
    {
      key: "unconfirmed",
      reason: "Prepare the channel list for the team review.",
      age: 90,
      status: "approved",
      delivered: true,
    },
    {
      key: "received-expired",
      reason: "Prepare yesterday’s team digest.",
      age: 100,
      status: "approved",
      delivered: true,
      received: true,
      agent: "long",
      account: "long",
    },
    {
      key: "stopped",
      reason: "Prepare the planning meeting handoff.",
      age: 50,
      status: "cancelled",
    },
    {
      key: "stopped-received",
      reason: "Summarize the last design review.",
      age: 60,
      status: "cancelled",
      delivered: true,
      received: true,
    },
    {
      key: "account-blocked",
      reason: "Compile the design workspace channel index.",
      age: 20,
      status: "approved",
      account: "disconnected",
      delivered: true,
      received: true,
    },
    {
      key: "agent-stopped",
      reason: "Prepare the assistant’s weekly digest.",
      age: 18,
      status: "approved",
      agent: "stopped",
      delivered: true,
      received: true,
    },
    {
      key: "pending-blocked",
      reason: "Find workspace channels for the research report.",
      age: 12,
      account: "disconnected",
    },
    {
      key: "pending-stopped",
      reason: "Summarize the public project updates.",
      age: 11,
      agent: "stopped",
    },
    ...Array.from({ length: 12 }, (_, i) => ({
      key: `history-${i}`,
      reason: `Historical review ${i + 1}: summarize the team’s public project channels.`,
      age: 1440 + i * 60,
      status: i % 3 === 0 ? "denied" : "approved",
      delivered: i % 3 !== 0,
      received: i % 3 !== 0,
      agent: "release",
    })),
  ];
  return scenarios.map((s) => {
    const agent = s.agent ?? "research",
      account = s.account ?? "active";
    const created = now - s.age * minutes;
    const status = s.status ?? "pending";
    return {
      _creationTime: created,
      ownerId,
      key: `${prefix}:${s.key}`,
      requesterConnectionId: bindings.agents[agent],
      accountId: bindings.accounts[account],
      providerId: "slack",
      grantVersion: 1,
      snapshot: {
        accountLabel: labels[account],
        providerName: "Slack",
        accessDescription: "Read channel names",
        requesterName: names[agent],
        grantedScopes: ["channels:read", "identify"],
      },
      reason: s.reason,
      command: {
        argv: s.longCommand
          ? [
              "node",
              "scripts/prepare-weekly-design-and-customer-success-handoff.mjs",
              "--workspace",
              "design-and-customer-success",
              "--channels",
              "design-reviews,customer-feedback,launch-readiness",
              "--format",
              "markdown",
            ]
          : ["node", "-e", 'console.log("Scope UI demo")'],
        cwd: "/tmp/scope-ui-demo",
        envVar: "SLACK_TOKEN",
      },
      status,
      approvalExpiresAt: created + 30 * minutes,
      ...((status === "pending" || status === "approved") &&
        !s.received &&
        created + 30 * minutes <= now && { expiredAt: created + 30 * minutes }),
      ...(status !== "pending" && { decidedAt: created + minutes }),
      ...(s.delivered && {
        firstDeliveryAt: created + 2 * minutes,
        lastDeliveryAt: created + 2 * minutes,
        deliveryAttempts: 1,
      }),
      ...(s.received && { receivedAt: created + 3 * minutes }),
      ...(status === "cancelled" && { stoppedAt: created + 4 * minutes }),
    };
  });
}

function convex(args, capture = false) {
  console.log(`target: dev (${deployment}, personal dev)`);
  const result = spawnSync(
    "pnpm",
    ["exec", "convex", ...args, "--deployment", deployment],
    {
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Convex command failed.");
  return capture ? JSON.parse(result.stdout) : undefined;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const ownerId = process.argv[2];
  if (!ownerId || !/^user_[A-Za-z0-9]+$/.test(ownerId))
    throw new Error("Usage: node scripts/seed-ui-review.mjs USER_ID");
  const bindings = convex(
    ["run", "uiReview:prepare", JSON.stringify({ ownerId })],
    true,
  );
  const rows = reviewRequests(ownerId, bindings);
  const dir = mkdtempSync(join(tmpdir(), "scope-ui-review-"));
  try {
    const path = join(dir, "requests.json");
    writeFileSync(path, JSON.stringify(rows));
    convex(["import", "--table", "approvalRequests", "--append", path]);
    convex(["run", "migrations:run", JSON.stringify({ reset: true })]);
    const counts = convex(
      [
        "run",
        "--inline-query",
        `
      const ownerId = ${JSON.stringify(ownerId)};
      const accounts = await ctx.db.query("connectedAccounts").withIndex("by_ownerId_and_state_and_disconnectOutcome", q => q.eq("ownerId", ownerId)).take(201);
      const agents = await ctx.db.query("clientConnections").withIndex("by_ownerId", q => q.eq("ownerId", ownerId)).take(201);
      const requests = await ctx.db.query("approvalRequests").withIndex("by_ownerId", q => q.eq("ownerId", ownerId)).take(201);
      return {
        accounts: accounts.filter(a => a.connect.issuer === "https://scope-ui-demo.invalid").length,
        agents: agents.filter(a => a.issuer === "https://scope-ui-demo.invalid").length,
        requests: requests.filter(r => r.key.startsWith("${prefix}:")).length,
      };`,
      ],
      true,
    );
    if (
      counts.accounts !== 5 ||
      counts.agents !== 4 ||
      counts.requests !== rows.length
    )
      throw new Error("Review fixture counts did not match.");
    console.log(
      `Verified ${counts.requests} demo requests, ${counts.accounts} demo accounts and ${counts.agents} demo agents. Existing records preserved.`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
