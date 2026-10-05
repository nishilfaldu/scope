// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { RequestRow } from "../components/approvals/request-row";
import { requestActivity, type ApprovalRequest } from "../lib/approval-display";
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
export const request = {
  _id: "request",
  _creationTime: 1000,
  accountId: "account",
  status: "pending",
  section: "pending",
  reason: "Summarize channel names",
  waitingUntil: Date.now() + 90_000,
  accountAvailable: true,
  collectionCount: 0,
  snapshot: {
    accountLabel: "Work workspace",
    providerName: "Slack",
    agentName: "Research assistant",
  },
} as ApprovalRequest;
test("pending row offers duration choices defaulting to thirty minutes, with reason apart from app identity", () => {
  const html = renderToStaticMarkup(<RequestRow request={request} />);
  expect(html).toContain("Research assistant");
  expect(html).toContain("Slack");
  expect(html).toContain("Work workspace");
  expect(html).toContain(">Reason<");
  expect(html).toContain("Summarize channel names");
  expect(html).toContain(">Approve<");
  expect(html).toMatch(/aria-pressed="true"[^>]*>30 min/);
  expect(html).not.toContain("channels:read");
  expect(html).not.toContain(">Command<");
});
test("active approvals have one status and End approval; history has no lifecycle controls", () => {
  for (const status of ["active", "ended", "expired", "denied"] as const) {
    const html = renderToStaticMarkup(
      <RequestRow
        request={{
          ...request,
          status,
          section: status === "active" ? "active" : "history",
          until: 2000,
        }}
      />,
    );
    expect(html).not.toContain(">Decision<");
    expect(html).not.toContain(">Delivery<");
    expect(html).not.toContain(">Approve<");
    expect(html).not.toMatch(/Stop sharing|disconnected|channels:read/);
    expect(html).toContain('aria-expanded="false"');
    if (status === "active") {
      expect(html).toContain("Approved until");
      expect(html).toContain("End approval");
    } else expect(html).not.toContain("End approval");
  }
});
test("activity is concise collection evidence rather than connection lifecycle logs", () => {
  expect(
    requestActivity({
      ...request,
      status: "ended",
      approvedAt: 1100,
      firstCollectedAt: 1200,
      lastCollectedAt: 1300,
      collectionCount: 2,
      receivedAt: 1400,
      endedAt: 1500,
      endReason: "account-disconnected",
    }),
  ).toEqual([
    { label: "Requested", at: 1000 },
    { label: "Approved", at: 1100 },
    { label: "First token collected", at: 1200 },
    { label: "Last token collected · 2 collections", at: 1300 },
    { label: "Receipt confirmed", at: 1400 },
    { label: "Ended", at: 1500 },
  ]);
});
test("activity keeps an early receipt before a later token collection", () => {
  expect(
    requestActivity({
      ...request,
      approvedAt: 1100,
      firstCollectedAt: 1200,
      receivedAt: 1250,
      lastCollectedAt: 1300,
      collectionCount: 2,
    }).map((event) => event.label),
  ).toEqual([
    "Requested",
    "Approved",
    "First token collected",
    "Receipt confirmed",
    "Last token collected · 2 collections",
  ]);
});
