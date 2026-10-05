// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ConnectionsBoard } from "../components/connections/connections-board";
const state = vi.hoisted(() => ({ accounts: [] as unknown[], toast: vi.fn() }));
vi.mock("convex/react", () => ({
  usePaginatedQuery: () => ({ results: state.accounts, status: "Exhausted" }),
}));
vi.mock("@/components/ui/toast", () => ({
  toast: { add: state.toast, close: vi.fn() },
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.toast.mockClear();
  state.accounts = [
    {
      _id: "saved",
      label: "Saved account",
      providerId: "example",
      providerName: "Example",
      grantedScopes: [],
      grantVersion: 1,
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        providers: [
          { providerId: "slack", provider: "Slack", available: false },
          { providerId: "example", provider: "Example", available: true },
        ],
      }),
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
test("groups follow catalog keys; a metadata outage disables only that connector", async () => {
  await act(async () => root.render(<ConnectionsBoard />));
  const groups = [...container.querySelectorAll("section")];
  expect(groups.map((g) => g.querySelector("h2")?.textContent)).toEqual([
    "Slack",
    "Example",
  ]);
  expect(groups[0].querySelector<HTMLButtonElement>("button")?.disabled).toBe(
    true,
  );
  expect(groups[1].querySelector<HTMLButtonElement>("button")?.disabled).toBe(
    false,
  );
  expect(container.textContent).toContain("Saved account");
  expect(state.toast).toHaveBeenCalledOnce();
});
test("saved accounts remain manageable without catalog metadata; unknown permissions are not called zero grants", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("outage");
    }),
  );
  await act(async () => root.render(<ConnectionsBoard />));
  expect(container.textContent).toContain("Example");
  const permissions = container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Permissions"]',
  )!;
  expect(permissions.textContent).toContain("—");
  await act(async () => permissions.click());
  expect(container.textContent).toContain(
    "Granted permissions are not available.",
  );
  const disconnect = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => b.textContent === "Disconnect")!;
  expect(disconnect.disabled).toBe(false);
  await act(async () => disconnect.click());
  expect(document.body.textContent).toContain("Disconnect Example?");
});
