// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  inspect: vi.fn(),
  proof: "private-proof",
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.proof ? { value: mocks.proof } : undefined),
  }),
}));
vi.mock("../lib/scope-server", () => ({
  config: () => "private-service",
  ownerDb: async () => mocks,
  scopeOrigin: () => "https://scope.example",
}));
vi.mock("../lib/connect", async (original) => ({
  ...(await original<typeof import("../lib/connect")>()),
  inspectConnection: mocks.inspect,
}));
import { GET } from "../app/api/accounts/complete/route";
const invoke = () =>
  GET(new Request("https://scope.example/api/accounts/complete?setup=abc123"));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.proof = "private-proof";
  mocks.query.mockResolvedValue({
    provisional: true,
    providerId: "slack",
    providerName: "Slack",
    connect: {
      connectorId: "connector",
      subjectId: "original",
      issuer: "https://scope.example",
    },
    requestedScopes: ["channels:read"],
  });
  mocks.inspect.mockResolvedValue({
    providerUserId: "U1",
    installationId: "I1",
    label: "Work",
    grantedScopes: ["channels:read"],
  });
  mocks.mutation.mockResolvedValue({ active: true, accountId: "abc123" });
});
test("verified callback activates the durable record", async () => {
  const res = await invoke();
  expect(res.headers.get("location")).toContain("connection=connected");
  expect(mocks.mutation.mock.calls[0][1]).toMatchObject({
    id: "abc123",
    activate: true,
    installationId: "I1",
  });
  expect(mocks.inspect).toHaveBeenCalledWith({
    connectorId: "connector",
    subjectId: "original",
    issuer: "https://scope.example",
    providerId: "slack",
    providerName: "Slack",
    scopes: ["channels:read"],
  });
  expect(res.headers.get("cache-control")).toBe("no-store");
});
test("failed callback retains the record for recovery", async () => {
  mocks.inspect.mockRejectedValue(new Error("private upstream error"));
  const res = await invoke();
  expect(res.headers.get("location")).toContain("connection=failed");
  expect(res.headers.get("location")).not.toContain("private");
  expect(getFunctionName(mocks.mutation.mock.calls[0][0])).toBe(
    "accounts:setupFailed",
  );
});
test("missing or rejected proof stops before provider IO", async () => {
  mocks.proof = "";
  await invoke();
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.proof = "bad";
  mocks.query.mockRejectedValue(new Error("Invalid proof"));
  await invoke();
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.mutation).not.toHaveBeenCalled();
});
test("completed callback is idempotent without another provider call", async () => {
  mocks.query.mockResolvedValue({ provisional: false, state: "active" });
  expect((await invoke()).headers.get("location")).toContain(
    "connection=connected",
  );
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.mutation).not.toHaveBeenCalled();
});
