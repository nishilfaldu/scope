// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { RequestCard } from "../components/approvals/request-card";
import {
  receiptDescription,
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
      <RequestCard request={request} account={account} now={1000} />,
    ),
  ).toContain("Approve access");
  for (const [r, a, now] of [
    [request, account, 2000],
    [request, { ...account, revoked: true }, 1000],
    [{ ...request, status: "cancelled" }, account, 1000],
    [{ ...request, status: "denied" }, account, 1000],
  ] as [ApprovalRequest, ApprovalAccount, number][]) {
    const html = renderToStaticMarkup(
      <RequestCard request={r} account={a} now={now} />,
    );
    expect(html).not.toContain("Approve access");
    expect(html).not.toContain("Stop further delivery");
  }
});
test("an expired approved request never says it is waiting for collection", () => {
  const r = { ...request, status: "approved" } as ApprovalRequest;
  const html = renderToStaticMarkup(
    <RequestCard request={r} account={account} now={2001} />,
  );
  expect(html).toContain("Expired");
  expect(html).not.toContain("Waiting for the helper to collect");
  expect(receiptDescription({ ...r, receivedAt: 1500 }, 2001)).toContain(
    "Helper confirmed receipt",
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
