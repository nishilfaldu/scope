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
  replies: new Map<number, unknown>(),
  history: [] as unknown[],
  ownerId: "user_owner",
  authenticated: true,
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: data.authenticated }),
  useQuery: (
    query: FunctionReference<"query">,
    args: { now?: number } | "skip",
  ) => {
    if (args === "skip") return undefined;
    return getFunctionName(query) === "approvals:pendingForOwner"
      ? data.replies.get(args.now!)
      : [];
  },
  usePaginatedQuery: () => ({
    results: data.history,
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
}));
vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  useAuth: () => ({ user: { id: data.ownerId } }),
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
  data.ownerId = "user_owner";
  data.authenticated = true;
  data.replies.clear();
  data.replies.set(start, [pending]);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("clock refresh keeps loaded requests and expanded activity mounted while pending data is fetched", async () => {
  await act(async () =>
    root.render(
      <PendingRequestsProvider>
        <ApprovalsBoard />
      </PendingRequestsProvider>,
    ),
  );
  const row = container.querySelector('article[aria-label*="older pending"]')!;
  const trigger = row.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  )!;
  await act(async () => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

  await act(async () => vi.advanceTimersByTime(30_000));
  expect(container.querySelector('[aria-label="Loading requests"]')).toBeNull();
  expect(container.textContent).toContain("Historical request");
  expect(container.contains(row)).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

function PendingProbe() {
  const { now, rows } = usePendingRequests();
  return (
    <output>
      {now}:{rows === undefined ? "Loading" : rows.map((r) => r._id).join(",")}
    </output>
  );
}

test("fresh query results replace retained pending data, including an empty result", async () => {
  const render = () =>
    root.render(
      <PendingRequestsProvider>
        <PendingProbe />
      </PendingRequestsProvider>,
    );
  await act(async () => render());
  expect(container.textContent).toContain("pending");
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(container.textContent).toContain("pending");
  data.replies.set(start + 30_000, []);
  await act(async () => render());
  expect(container.textContent).toBe(`${start + 30_000}:`);
});

test("retained rows never cross owners or survive logout", async () => {
  const render = () =>
    root.render(
      <PendingRequestsProvider>
        <PendingProbe />
      </PendingRequestsProvider>,
    );
  await act(async () => render());
  expect(container.textContent).toContain("pending");
  data.ownerId = "user_other";
  data.replies.clear();
  await act(async () => render());
  expect(container.textContent).toContain("Loading");
  expect(container.textContent).not.toContain("pending");
  data.replies.set(start, [{ ...pending, _id: "other-request" }]);
  await act(async () => render());
  expect(container.textContent).toContain("other-request");
  data.authenticated = false;
  await act(async () => render());
  expect(container.textContent).toContain("Loading");
  expect(container.textContent).not.toContain("other-request");
});

test("the local clock expires approval actions even while fresh data is unavailable", async () => {
  await act(async () =>
    root.render(
      <PendingRequestsProvider>
        <ApprovalsBoard />
      </PendingRequestsProvider>,
    ),
  );
  const row = container.querySelector('article[aria-label*="older pending"]')!;
  expect(row.textContent).toContain("Approve");
  await act(async () => vi.advanceTimersByTime(90_000));
  expect(container.contains(row)).toBe(true);
  expect(row.textContent).toContain("Expired");
  expect(row.textContent).not.toContain("Approve");
  expect(container.textContent).toContain("No requests need your approval.");
});
