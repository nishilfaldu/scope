// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { RequestRow } from "../components/approvals/request-row";
import {
  requestOutcome,
  requestTimeline,
  approvalStatus,
  type ApprovalRequest,
} from "../lib/approval-display";
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
const request = {
  _id: "request",
  accountId: "account",
  requesterConnectionId: "requester",
  reason: "Summarize channel names",
  approvalExpiresAt: 2000,
  status: "pending",
  accountAvailable: true,
  requesterStopped: false,
  command: { argv: ["node", "script.mjs"], cwd: "/tmp", envVar: "SLACK_TOKEN" },
  snapshot: {
    grantedScopes: ["channels:read"],
    accountLabel: "Work workspace",
    providerName: "Slack",
    accessDescription: "View public channels",
    requesterName: "Research assistant",
  },
} as ApprovalRequest;

test("only a live unblocked pending request exposes the approval action", () => {
  expect(
    renderToStaticMarkup(<RequestRow request={request} now={1000} />),
  ).toContain(">Approve<");
  for (const [r, now] of [
    [request, 2000],
    [{ ...request, accountAvailable: false }, 1000],
    [{ ...request, status: "cancelled" }, 1000],
    [{ ...request, status: "denied" }, 1000],
  ] as [ApprovalRequest, number][]) {
    const html = renderToStaticMarkup(<RequestRow request={r} now={now} />);
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain("Stop further delivery");
  }
});
test("an expired approved request never says it is waiting for collection", () => {
  const r = { ...request, status: "approved" } as ApprovalRequest;
  const html = renderToStaticMarkup(<RequestRow request={r} now={2001} />);
  expect(html).toContain("Not collected");
  expect(html).not.toContain("Waiting for the helper to collect");
  expect(requestOutcome({ ...r, receivedAt: 1500 }, 2001)).toContain(
    "confirmed receipt",
  );
});

test("a request is one compact row with purpose and full permissions", () => {
  const r = {
    ...request,
    createdAt: 900,
    reason: "Read workspace channel names",
  };
  const html = renderToStaticMarkup(
    <RequestRow request={r} now={1000} focused />,
  );
  expect(html.match(/<article/g)).toHaveLength(1);
  expect(html).toContain("Research assistant");
  expect(html).toContain("View public channels");
  expect(html).not.toContain("Request timeline");
  expect(html).not.toContain("PAT");
  expect(html).not.toContain("scope:owner:client:consent");
  expect(html).not.toContain("usr-work");
  expect(html).toContain("Read workspace channel names");
  expect(html).toContain("Full connection permissions");
  expect(html).toContain("purpose does not limit");
});
test("approval, attempted delivery and receipt remain distinct even after expiry", () => {
  const approved = {
    ...request,
    status: "approved",
    createdAt: 100,
    decidedAt: 200,
  } as ApprovalRequest;
  expect(approvalStatus(approved, 1000)).toBe("Waiting for pickup");
  expect(requestTimeline(approved, 1000).map((e) => e.label)).not.toContain(
    "Receipt confirmed",
  );
  const attempted = { ...approved, deliveredAt: 300 };
  expect(approvalStatus(attempted, 1000)).toBe("Waiting for receipt");
  expect(approvalStatus(attempted, 3000)).toBe("Receipt unconfirmed");
  const received = { ...attempted, receivedAt: 400 };
  expect(approvalStatus(received, 3000)).toBe("Received");
  expect(requestTimeline(received, 3000).map((e) => [e.label, e.at])).toEqual([
    ["Requested", 100],
    ["Approved", 200],
    ["Delivery attempted", 300],
    ["Receipt confirmed", 400],
    ["Delivery window ended", 2000],
  ]);
});
test("legacy stops have no invented timestamp and do not imply access was revoked", () => {
  const stopped = {
    ...request,
    status: "cancelled",
    decidedAt: 200,
    deliveredAt: 300,
    receivedAt: 400,
  } as ApprovalRequest;
  const events = requestTimeline(stopped, 3000);
  expect(events.at(-1)).toMatchObject({
    label: "Delivery stopped",
    at: undefined,
    detail: "Previously received access is unaffected.",
  });
  expect(events.map((e) => e.label)).not.toContain("Delivery window ended");
  expect(requestTimeline({ ...stopped, stoppedAt: 500 }, 3000).at(-1)?.at).toBe(
    500,
  );
  expect(
    requestTimeline({ ...request, status: "denied", decidedAt: 200 }, 3000).map(
      (e) => e.label,
    ),
  ).toEqual(["Requested", "Denied"]);
});
test("provider expiry never shortens the fixed approval deadline", () => {
  const r = {
    ...request,
    status: "approved",
    providerExpiresAt: 1200,
  } as ApprovalRequest;
  expect(approvalStatus(r, 1500)).toBe("Waiting for pickup");
  expect(requestTimeline(r, 2100).at(-1)).toMatchObject({
    label: "Delivery window ended",
    at: 2000,
  });
});

test("stopped CLI timelines never wait and use only recorded stop times", () => {
  const stopped = {
    ...request,
    status: "approved",
    decidedAt: 200,
    requesterStopped: true,
    requesterStoppedAt: 500,
  } as ApprovalRequest;
  for (const now of [1000, 3000]) {
    const events = requestTimeline(stopped, now);
    expect(events.at(-1)).toMatchObject({
      label: "Connection sharing stopped",
      at: 500,
    });
    expect(events.some((e) => /Waiting|window ended/.test(e.label))).toBe(
      false,
    );
  }
  const unknown = { ...stopped, requesterStoppedAt: undefined };
  expect(requestTimeline(unknown, 3000).at(-1)).toMatchObject({
    label: "Connection sharing stopped",
    at: undefined,
  });
});
