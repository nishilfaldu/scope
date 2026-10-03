// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { RequestRow } from "../components/approvals/request-row";
import {
  requestOutcome,
  requestTimeline,
  approvalStatus,
  type ApprovalRequest,
  type ApprovalAccount,
} from "../lib/approval-display";
import LegacyLabPage from "../app/lab/page";
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
const account = {
  _id: "account",
  label: "Work base",
  providerUserId: "usr-work",
  credentialKind: "shared-pat",
  revoked: false,
} as ApprovalAccount;
const request = {
  _id: "request",
  accountId: "account",
  requester: "scope:owner:client:consent",
  reason: "Read this base",
  expiresAt: 2000,
  status: "pending",
} as ApprovalRequest;

test("only a live unblocked pending request exposes the approval action", () => {
  expect(
    renderToStaticMarkup(
      <RequestRow request={request} account={account} now={1000} />,
    ),
  ).toContain(">Approve<");
  for (const [r, a, now] of [
    [request, account, 2000],
    [request, { ...account, revoked: true }, 1000],
    [{ ...request, status: "cancelled" }, account, 1000],
    [{ ...request, status: "denied" }, account, 1000],
  ] as [ApprovalRequest, ApprovalAccount, number][]) {
    const html = renderToStaticMarkup(
      <RequestRow request={r} account={a} now={now} />,
    );
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain("Stop further delivery");
  }
});
test("an expired approved request never says it is waiting for collection", () => {
  const r = { ...request, status: "approved" } as ApprovalRequest;
  const html = renderToStaticMarkup(
    <RequestRow request={r} account={account} now={2001} />,
  );
  expect(html).toContain("Not collected");
  expect(html).not.toContain("Waiting for the helper to collect");
  expect(requestOutcome({ ...r, receivedAt: 1500 }, 2001)).toContain(
    "confirmed receipt",
  );
});
test("legacy links preserve the exact request and WorkOS transaction when redirecting", async () => {
  await expect(
    LegacyLabPage({ searchParams: Promise.resolve({ request: "request-id" }) }),
  ).rejects.toThrow("redirect:/approvals?request=request-id");
  await expect(
    LegacyLabPage({
      searchParams: Promise.resolve({ external_auth_id: "external+id" }),
    }),
  ).rejects.toThrow("redirect:/authorize-agent?external_auth_id=external%2Bid");
  await expect(
    LegacyLabPage({ searchParams: Promise.resolve({ account: "account-id" }) }),
  ).rejects.toThrow("redirect:/connections?account=account-id#airtable");
});

test("a request is one compact row without technical metadata or its diagnostic reason", () => {
  const r = {
    ...request,
    requesterName: "Research assistant",
    createdAt: 900,
    reason: "private diagnostic PAT reason",
  };
  const html = renderToStaticMarkup(
    <RequestRow
      request={r}
      account={{ ...account, label: "Work base · shared read-only PAT" }}
      now={1000}
      focused
    />,
  );
  expect(html.match(/<article/g)).toHaveLength(1);
  expect(html).toContain("Research assistant");
  expect(html).toContain("Read-only access to Work base");
  expect(html).not.toContain("Request timeline");
  expect(html).not.toContain("PAT");
  expect(html).not.toContain(r.requester);
  expect(html).not.toContain("usr-work");
  expect(html).not.toContain("private diagnostic");
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
test("the earlier recorded delivery deadline controls waiting and expiry", () => {
  const r = {
    ...request,
    status: "approved",
    deliveryExpiresAt: 1200,
  } as ApprovalRequest;
  expect(approvalStatus(r, 1500)).toBe("Not collected");
  expect(requestTimeline(r, 1500).at(-1)).toMatchObject({
    label: "Delivery window ended",
    at: 1200,
  });
});

test("stopped MCP timelines never wait and use only recorded stop times", () => {
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
