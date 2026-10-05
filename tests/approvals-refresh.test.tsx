// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ApprovalsBoard } from "../components/approvals/approvals-board";
import { PendingRequestsProvider } from "../components/approvals/pending-requests-provider";
const data = vi.hoisted(() => ({
  count: 1,
  pending: [] as unknown[],
  active: [] as unknown[],
  history: [] as unknown[],
  query: vi.fn(),
  load: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: true }),
  useQuery: (ref: FunctionReference<"query">, args: unknown) => {
    data.query(getFunctionName(ref), args);
    return getFunctionName(ref) === "access:pendingCount"
      ? data.count
      : undefined;
  },
  usePaginatedQuery: (
    _ref: unknown,
    { section }: { section: "pending" | "active" | "history" },
  ) => ({
    results: data[section],
    status: section === "history" ? "CanLoadMore" : "Exhausted",
    loadMore: data.load,
  }),
}));
vi.mock("@/components/ui/toast", () => ({ toast: { add: vi.fn() } }));
let root: Root, container: HTMLDivElement;
const pending = {
  _id: "pending",
  _creationTime: 1700000000000,
  reason: "Review pending",
  status: "pending",
  section: "pending",
  accountAvailable: true,
  waitingUntil: 1700000090000,
  collectionCount: 0,
  snapshot: {
    accountLabel: "Work",
    providerName: "Slack",
    agentName: "Research",
  },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data.pending = [pending];
  data.active = [];
  data.history = [];
  data.count = 1;
  data.query.mockClear();
  data.load.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function render() {
  root.render(
    <PendingRequestsProvider>
      <ApprovalsBoard />
    </PendingRequestsProvider>,
  );
}
test("local countdown leaves parent queries and expanded activity alone", async () => {
  await act(render);
  const row = container.querySelector("article")!,
    trigger = row.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  await act(() => trigger.click());
  const calls = data.query.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(30000));
  expect(row.textContent).toContain("1 min to decide");
  expect(data.query).toHaveBeenCalledTimes(calls);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(container.contains(row)).toBe(true);
});
test("reactive decisions move requests between sections; each section can load more", async () => {
  await act(render);
  data.pending = [];
  data.active = [
    {
      ...pending,
      status: "active",
      section: "active",
      approvedAt: 1700000000000,
      until: 1700001800000,
    },
  ];
  data.count = 0;
  await act(render);
  expect(container.textContent).toContain("Approved until");
  expect(container.textContent).toContain("End approval");
  expect(container.textContent).toContain("No requests need");
  const more = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Load more",
  )!;
  await act(() => more.click());
  expect(data.load).toHaveBeenCalledWith(20);
});
