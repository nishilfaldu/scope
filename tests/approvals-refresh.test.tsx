// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ApprovalsBoard } from "../components/approvals/approvals-board";
import {
  PendingRequestsProvider,
  usePendingRequests,
} from "../components/approvals/pending-requests-provider";
import type { ApprovalRequest } from "../lib/approval-display";

const data = vi.hoisted(() => ({
  pending: undefined as unknown,
  history: [] as unknown[],
  authenticated: true,
  pendingQuery: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: data.authenticated }),
  useQuery: (query: FunctionReference<"query">, args: object | "skip") => {
    if (getFunctionName(query) === "approvals:pendingForOwner") {
      data.pendingQuery(args);
      return args === "skip" ? undefined : data.pending;
    }
    return args === "skip" ? undefined : [];
  },
  usePaginatedQuery: () => ({
    results: data.history,
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
}));
vi.mock("@/components/ui/toast", () => ({ toast: { add: vi.fn() } }));
const start = 1_700_000_000_000;
const pending = {
  _id: "pending",
  createdAt: start - 1000,
  reason: "Review the older pending request",
  approvalExpiresAt: start + 90_000,
  status: "pending",
  accountAvailable: true,
  requesterStopped: false,
  command: { argv: ["node", "script.mjs"], cwd: "/tmp", envVar: "SLACK_TOKEN" },
  snapshot: {
    accountLabel: "Work workspace",
    providerName: "Slack",
    requesterName: "Research assistant",
  },
} as ApprovalRequest;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  data.authenticated = true;
  data.pending = [pending];
  data.pendingQuery.mockClear();
  data.history = [
    {
      ...pending,
      _id: "history",
      reason: "Historical request",
      status: "denied",
    },
  ];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function board() {
  root.render(
    <PendingRequestsProvider>
      <ApprovalsBoard />
    </PendingRequestsProvider>,
  );
}
function PendingProbe() {
  const { rows } = usePendingRequests();
  return (
    <output>
      {rows === undefined ? "Loading" : rows.map((r) => r._id).join(",")}
    </output>
  );
}
function probe() {
  root.render(
    <PendingRequestsProvider>
      <PendingProbe />
    </PendingRequestsProvider>,
  );
}

test("countdown ticks only update its text, leaving queries and expanded activity alone", async () => {
  await act(async () => board());
  const row = container.querySelector('article[aria-label*="older pending"]')!;
  const trigger = row.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  )!;
  await act(async () => trigger.click());
  const calls = data.pendingQuery.mock.calls.length;
  expect(row.textContent).toContain("2 min to decide");
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(row.textContent).toContain("1 min to decide");
  expect(data.pendingQuery).toHaveBeenCalledTimes(calls);
  expect(
    data.pendingQuery.mock.calls.every(
      ([args]) => JSON.stringify(args) === "{}",
    ),
  ).toBe(true);
  expect(container.querySelector('[aria-label="Loading requests"]')).toBeNull();
  expect(container.contains(row)).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("Historical request");
});
test("reactive expiry removes actions and updates an open row without a clock refresh", async () => {
  await act(async () => board());
  const row = container.querySelector('article[aria-label*="older pending"]')!;
  const trigger = row.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  )!;
  await act(async () => trigger.click());
  data.pending = [];
  data.history = [
    { ...pending, expiredAt: pending.approvalExpiresAt },
    ...data.history,
  ];
  await act(async () => board());
  expect(container.contains(row)).toBe(true);
  expect(row.textContent).toContain("Expired");
  expect(row.textContent).not.toContain("Approve");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("No requests need your approval.");
});
test("fresh empty results clear pending rows and logout skips the query", async () => {
  await act(async () => probe());
  expect(container.textContent).toBe("pending");
  data.pending = [];
  await act(async () => probe());
  expect(container.textContent).toBe("");
  data.pending = [pending];
  data.authenticated = false;
  await act(async () => probe());
  expect(container.textContent).toBe("Loading");
  expect(data.pendingQuery).toHaveBeenLastCalledWith("skip");
});
test("completed requests do not mount a local timer", async () => {
  data.pending = [];
  const interval = vi.spyOn(window, "setInterval");
  await act(async () => board());
  expect(interval).not.toHaveBeenCalled();
  const calls = data.pendingQuery.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(data.pendingQuery).toHaveBeenCalledTimes(calls);
});
