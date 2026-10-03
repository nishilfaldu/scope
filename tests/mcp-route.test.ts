// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  ensure: vi.fn(),
  accounts: vi.fn(),
  collectors: vi.fn(),
  request: vi.fn(),
  status: vi.fn(),
  wait: vi.fn(),
}));
vi.mock("../lib/scope-server", () => ({
  clientActor: mocks.actor,
  scopeOrigin: () => "https://scope.example",
}));
vi.mock("../lib/approval-service", () => ({
  ensureConnection: mocks.ensure,
  listAccounts: mocks.accounts,
  listCollectors: mocks.collectors,
  requestAccess: mocks.request,
  requestStatus: mocks.status,
  waitForDecision: mocks.wait,
}));
import { POST } from "../app/api/mcp/route";
const invoke = (method: string, params: unknown = {}, origin?: string) =>
  POST(
    new Request("https://scope.example/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ userId: "owner", clientId: "native" });
  mocks.accounts.mockResolvedValue([]);
  mocks.collectors.mockResolvedValue([{ id: "helper", name: "My helper" }]);
  mocks.request.mockResolvedValue({
    id: "request",
    approvalUrl: "https://scope.example/approvals?request=request",
  });
  mocks.wait.mockResolvedValue({
    requestId: "request",
    status: "approved",
    approvalExpiresAt: 123,
  });
});
test("hosted tool catalog exposes four control-plane tools and no credential collector", async () => {
  const response = await invoke("tools/list");
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.result.tools.map((t: { name: string }) => t.name)).toEqual([
    "list_accounts",
    "list_collectors",
    "request_access",
    "get_request_status",
  ]);
  expect(JSON.stringify(data)).not.toContain("deliver_credential");
});
test("native request binds designated collector and returns only approval metadata", async () => {
  const response = await invoke("tools/call", {
    name: "request_access",
    arguments: {
      accountId: "account",
      collectorConnectionId: "helper",
      key: "native-request-12345",
      reason: "Read bases",
      waitSeconds: 0,
    },
  });
  const data = await response.json();
  expect(mocks.request.mock.calls[0][1]).toMatchObject({
    collectorConnectionId: "helper",
  });
  expect(JSON.parse(data.result.content[0].text)).toEqual({
    requestId: "request",
    status: "approved",
    approvalExpiresAt: 123,
    approvalUrl: "https://scope.example/approvals?request=request",
    retryKey: "native-request-12345",
  });
});
test("invalid authentication challenges exact resource without service activity", async () => {
  mocks.actor.mockRejectedValue(new Error("wrong audience"));
  const response = await invoke("tools/list");
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain(
    "/.well-known/oauth-protected-resource/api/mcp",
  );
  expect(mocks.ensure).not.toHaveBeenCalled();
  expect(mocks.accounts).not.toHaveBeenCalled();
});
test("cross-origin browser calls cannot invoke hosted tools", async () => {
  const response = await invoke("tools/list", {}, "https://other.example");
  expect(response.status).toBe(403);
  expect(mocks.accounts).not.toHaveBeenCalled();
});
