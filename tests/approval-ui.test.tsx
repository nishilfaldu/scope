// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { RequestRow } from "../components/approvals/request-row";
import {
  requestDecision,
  requestDelivery,
  requestActivity,
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
  expect(renderToStaticMarkup(<RequestRow request={request} />)).toContain(
    ">Approve<",
  );
  for (const r of [
    { ...request, expiredAt: 2000 },
    { ...request, accountAvailable: false },
    { ...request, status: "cancelled" },
    { ...request, status: "denied" },
  ] as ApprovalRequest[]) {
    const html = renderToStaticMarkup(<RequestRow request={r} />);
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain("Stop further sharing");
  }
});
test("an expired approved request never says it is waiting for collection", () => {
  const r = {
    ...request,
    status: "approved",
    expiredAt: 2000,
  } as ApprovalRequest;
  const html = renderToStaticMarkup(<RequestRow request={r} />);
  expect(html).toContain("Not collected");
  expect(html).not.toContain("Waiting for the helper to collect");
  expect(requestDelivery({ ...r, receivedAt: 1500 })?.label).toBe("Received");
});

test("a request separates its reason from app identity and omits permissions", () => {
  const r = {
    ...request,
    createdAt: 900,
    reason: "Read workspace channel names",
  };
  const html = renderToStaticMarkup(<RequestRow request={r} focused />);
  expect(html.match(/<article/g)).toHaveLength(1);
  expect(html).toContain("Research assistant");
  expect(html).toContain("Slack");
  expect(html).toContain("Work workspace");
  expect(html).not.toContain("View public channels");
  expect(html).not.toContain("Request timeline");
  expect(html).not.toContain("PAT");
  expect(html).not.toContain("scope:owner:client:consent");
  expect(html).not.toContain("usr-work");
  expect(html).toContain("Read workspace channel names");
  expect(html).toContain(">Reason<");
  expect(html).not.toContain("Full connection permissions");
  expect(html).not.toContain("purpose does not limit");
  const history = renderToStaticMarkup(
    <RequestRow
      request={{
        ...r,
        status: "approved",
        receivedAt: 1100,
        requesterStopped: true,
      }}
      focused
    />,
  );
  expect(history).toContain("Read workspace channel names");
  expect(history).not.toContain("channels:read");
  expect(history).not.toContain("Previously received access may remain active");
});
test("approval and receipt are separate, persistent facts", () => {
  const approved = {
    ...request,
    status: "approved",
    createdAt: 100,
    decidedAt: 200,
  } as ApprovalRequest;
  expect(requestDecision(approved)).toEqual({
    label: "Approved",
    at: 200,
  });
  expect(requestDelivery(approved)).toEqual({
    label: "Waiting for pickup",
  });
  expect(requestDelivery({ ...approved, deliveredAt: 300 })).toEqual({
    label: "Waiting for receipt",
    at: 300,
  });
  const received = { ...approved, deliveredAt: 300, receivedAt: 400 };
  for (const change of [
    {},
    { status: "cancelled", stoppedAt: 500 },
    { accountAvailable: false, accountBlockedAt: 600 },
    { requesterStopped: true, requesterStoppedAt: 700 },
  ]) {
    const r = { ...received, ...change } as ApprovalRequest;
    for (const expiredAt of [undefined, 2000]) {
      const closed = { ...r, expiredAt };
      expect(requestDecision(closed)).toEqual({ label: "Approved", at: 200 });
      expect(requestDelivery(closed)).toEqual({ label: "Received", at: 400 });
      const html = renderToStaticMarkup(
        <RequestRow request={closed} focused />,
      );
      expect(html).toContain(">Decision<");
      expect(html).toContain(">Approved<");
      expect(html).toContain(">Delivery<");
      expect(html).toContain(">Received<");
      expect(html).not.toContain("Sharing blocked");
      expect(html).not.toContain("Account sharing blocked");
      expect(html).not.toContain("Connection sharing stopped");
      expect(html).toContain('aria-expanded="false"');
      expect(html).not.toContain('aria-label="Request activity"');
    }
  }
});
test("uncollected approvals stay approved and use the fixed deadline", () => {
  const r = {
    ...request,
    status: "approved",
    decidedAt: 200,
    providerExpiresAt: 1200,
  } as ApprovalRequest;
  const closed = { ...r, expiredAt: 2000 };
  expect(requestDecision(closed).label).toBe("Approved");
  expect(requestDelivery(r)?.label).toBe("Waiting for pickup");
  expect(requestDelivery(closed)).toEqual({
    label: "Not collected",
    at: 2000,
  });
  expect(requestDelivery({ ...closed, deliveredAt: 300 })).toEqual({
    label: "Receipt unconfirmed",
    at: 2000,
  });
  expect(requestActivity({ ...r, deliveredAt: 300, receivedAt: 400 })).toEqual([
    { label: "Requested", at: undefined },
    { label: "Approved", at: 200 },
    { label: "Delivery attempted", at: 300 },
    { label: "Received", at: 400 },
  ]);
});
test("account and agent lifecycle metadata does not change request facts or activity", () => {
  for (const base of [
    { ...request, status: "approved", decidedAt: 200 },
    { ...request, status: "approved", decidedAt: 200, deliveredAt: 300 },
    {
      ...request,
      status: "approved",
      decidedAt: 200,
      deliveredAt: 300,
      receivedAt: 400,
    },
  ] as ApprovalRequest[]) {
    for (const expiredAt of [undefined, 2000])
      for (const change of [
        { accountAvailable: false, accountBlockedAt: 500 },
        { requesterStopped: true, requesterStoppedAt: 600 },
        { accountAvailable: false, requesterStopped: true },
      ]) {
        const closed = { ...base, expiredAt };
        const r = { ...closed, ...change };
        expect(requestDecision(r)).toEqual(requestDecision(closed));
        expect(requestDelivery(r)).toEqual(requestDelivery(closed));
        expect(requestActivity(r)).toEqual(requestActivity(closed));
        const html = renderToStaticMarkup(<RequestRow request={r} />);
        expect(html).not.toMatch(
          /Account disconnected|Agent disconnected|Account sharing|Connection sharing|Stop further sharing/,
        );
      }
  }
});
test("missing legacy times are never replaced with unrelated dates", () => {
  const approved = { ...request, status: "approved" } as ApprovalRequest;
  expect(
    requestDelivery({ ...approved, status: "cancelled", decidedAt: 200 }),
  ).toEqual({
    label: "Delivery stopped",
    at: undefined,
  });
  expect(
    requestDelivery({ ...approved, accountAvailable: false, expiredAt: 2000 }),
  ).toEqual({
    label: "Not collected",
    at: 2000,
  });
  expect(requestDecision({ ...approved, receivedAt: 400 })).toEqual({
    label: "Approved",
    at: undefined,
  });
});
test("denial and undecided requests do not imply a delivery or approval", () => {
  const denied = {
    ...request,
    status: "denied",
    decidedAt: 200,
    accountAvailable: false,
  } as ApprovalRequest;
  expect(requestDecision(denied)).toEqual({ label: "Denied", at: 200 });
  expect(requestDelivery(denied)).toBeUndefined();
  expect(requestActivity(denied).map((e) => e.label)).toEqual([
    "Requested",
    "Denied",
  ]);
  const blocked = {
    ...request,
    accountAvailable: false,
    accountBlockedAt: 500,
  };
  expect(requestDecision(blocked)).toEqual({ label: "Not decided" });
  expect(approvalStatus(blocked)).not.toBe("Needs approval");
  expect(requestDelivery(blocked)).toBeUndefined();
  expect(requestDecision({ ...blocked, expiredAt: 2000 })).toEqual({
    label: "Expired",
    at: 2000,
  });
  expect(
    requestActivity({ ...blocked, expiredAt: 2000 }).map((e) => e.label),
  ).toEqual(["Requested", "Request expired"]);
});

test("command is visible for every outcome, whether history is expanded or collapsed", () => {
  const cases: ApprovalRequest[] = [
    request,
    { ...request, status: "denied" },
    { ...request, status: "cancelled" },
    { ...request, approvalExpiresAt: 500, expiredAt: 500 },
    { ...request, status: "approved" },
    { ...request, status: "approved", deliveredAt: 700 },
    { ...request, status: "approved", receivedAt: 800 },
    { ...request, status: "approved", approvalExpiresAt: 500, expiredAt: 500 },
    {
      ...request,
      status: "approved",
      deliveredAt: 300,
      approvalExpiresAt: 500,
      expiredAt: 500,
    },
    { ...request, accountAvailable: false },
  ];
  for (const r of cases)
    for (const focused of [true, false]) {
      const html = renderToStaticMarkup(
        <RequestRow request={r} focused={focused} />,
      );
      expect(html).toContain(">Command<");
      expect(html).toContain("node script.mjs");
      expect(html).not.toContain("channels:read");
      expect(html).not.toContain("attention");
      expect(html.indexOf(">Command<")).toBeLessThan(
        html.indexOf(">Approve<") === -1 ? Infinity : html.indexOf(">Approve<"),
      );
    }
});
