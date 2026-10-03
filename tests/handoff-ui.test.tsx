// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import { ConnectAgent } from "../components/agents/connect-agent";
import { AgentsBoard } from "../components/agents/agents-board";
import { RequestDecision } from "../components/requests/request-decision";
import { SliceOverview } from "../components/slices/slice-overview";

const state = vi.hoisted(() => ({
  now: 1_000_000,
  queries: new Map<string, unknown>(),
  pages: new Map<string, unknown[]>(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => vi.fn(),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    return args === "skip" ? undefined : state.queries.get(name);
  },
  usePaginatedQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    return {
      results: state.pages.get(name) ?? [],
      status: "Exhausted",
      loadMore: vi.fn(),
    };
  },
}));
vi.mock("../hooks/use-now", () => ({ useNow: () => state.now }));
vi.mock("../lib/errors", () => ({
  useErrorCatchingMutation: () => [vi.fn(), false],
}));
vi.mock("../components/layout/board-shell", () => ({
  BoardShell: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("../components/shared/authorization-shell", () => ({
  AuthorizationShell: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("../components/auth/sign-in", () => ({ SignIn: () => null }));
vi.mock("../components/slices/slice-apps", () => ({ SliceApps: () => null }));
vi.mock("../components/connections/account-bindings", () => ({
  AccountBindings: () => null,
  bindingsFor: () => [],
}));

beforeEach(() => {
  state.queries.clear();
  state.pages.clear();
});

const invite = {
  agentId: "agent",
  agentName: "Research",
  reconnecting: false,
  status: "claimed",
  approvalDeadlineAt: 2_000_000,
  ackDeadlineAt: 1_120_000,
  replacementOptions: [],
  handoffStatus: "waiting_for_ack",
  resourceStatus: "staged",
};
const request = {
  publicToken: "request",
  status: "claimed",
  agentName: "Research",
  apps: ["slack"],
  ttlMs: 60_000,
  reason: "Read issues",
  approvalDeadlineAt: 2_000_000,
  ackDeadlineAt: 1_120_000,
  sliceExpiresAt: 1_060_000,
  resourceStatus: "staged",
};

test("replacement screen shows activation deadline and hides new-agent controls", () => {
  state.queries.set("tables/agentConnections:getInvite", {
    ...invite,
    reconnecting: true,
    handoffStatus: "waiting_for_activation",
    ackDeadlineAt: undefined,
    activationDeadlineAt: 1_120_000,
  });
  const html = renderToStaticMarkup(<ConnectAgent publicToken="pairing" />);
  expect(html).toContain("Waiting for replacement activation");
  expect(html).toContain("Activation deadline");
  expect(html).not.toContain("Acknowledgment deadline");
  expect(html).not.toContain("Connection destination");
});

test("revoked pending requests cannot show approval or policy controls", () => {
  state.queries.set("tables/slices/sliceRequests:get", {
    ...request,
    status: "pending",
    handoffStatus: "revoked",
  });
  const html = renderToStaticMarkup(
    <RequestDecision kind="new" publicToken="request" />,
  );
  expect(html).toContain("Revoked");
  expect(html).not.toContain("Allow automatic credential minting");
  expect(html).not.toContain(">Deny<");
});

test.each(["waiting_for_pickup", "waiting_for_ack"])(
  "slice overview disables policy and retains revoke during %s",
  (handoffStatus) => {
    state.queries.set("tables/slices/queries:get", {
      _id: "slice",
      name: "Research",
      token: "token",
      status: "staged",
      expiresAt: 2_000_000,
      mintPolicy: "auto",
      handoffStatus,
      handoffDeadlineAt: 1_120_000,
    });
    const html = renderToStaticMarkup(<SliceOverview sliceId="slice" />);
    const switchElement = html.match(/<[^>]*data-slot="switch"[^>]*>/)?.[0];
    expect(switchElement).toContain("data-disabled");
    expect(html).toContain("Revoke");
    expect(html).toContain(
      handoffStatus === "waiting_for_pickup"
        ? "Pickup deadline"
        : "Acknowledgment deadline",
    );
    if (handoffStatus === "waiting_for_pickup")
      expect(html).not.toContain("Waiting for agent acknowledgment");
  },
);

test("agent board shows staged replacement progress and the revoke action", () => {
  state.pages.set("tables/agentDashboard:activePage", [
    { _id: "old", agentId: "agent", name: "Research", status: "active" },
  ]);
  state.queries.set("tables/agentDashboard:list", [
    {
      _id: "replacement",
      agentId: "agent",
      name: "Research replacement",
      status: "staged",
      handoffStatus: "waiting_for_activation",
      handoffDeadlineAt: 1_120_000,
    },
  ]);
  const html = renderToStaticMarkup(<AgentsBoard />);
  expect(html).toContain("Waiting for replacement activation");
  expect(html).toContain("Revoke");
});
