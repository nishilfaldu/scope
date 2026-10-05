// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  disconnect: vi.fn(),
  metadata: vi.fn(),
  owner: vi.fn(),
  inspect: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../lib/scope-server", () => ({
  config: () => "private-service",
  ownerDb: async () => {
    await mocks.owner();
    return mocks;
  },
  sameOrigin: vi.fn(),
  json: (body: unknown) => Response.json(body),
  safeError: (status = 400) =>
    Response.json({ code: "authority-invalid" }, { status }),
  safeFailure: () =>
    Response.json({ code: "retryable-unavailable" }, { status: 503 }),
}));
vi.mock("../lib/connect", async (original) => ({
  ...(await original<typeof import("../lib/connect")>()),
  disconnect: mocks.disconnect,
  availableConnectors: mocks.metadata,
  inspectConnection: mocks.inspect,
}));
import { GET, POST } from "../app/api/accounts/[operation]/route";
const reference = {
  provisional: false,
  connect: {
    connectorId: "connector",
    subjectId: "original",
    issuer: "https://scope.example",
    installationId: "installation",
  },
  providerId: "slack",
  grantedScopes: ["channels:read"],
  grantVersion: 3,
  providerUserId: "U1",
};
const invoke = () =>
  POST(
    new Request("https://scope.example/api/accounts/disconnect", {
      method: "POST",
      body: JSON.stringify({ id: "account", grantVersion: 3 }),
    }),
    { params: Promise.resolve({ operation: "disconnect" }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue(reference);
  mocks.mutation.mockImplementation(async (fn) =>
    getFunctionName(fn) === "accounts:block" ? reference : "succeeded",
  );
  mocks.disconnect.mockResolvedValue({ outcome: "succeeded" });
});
test("blocks before Connect IO, targets the exact grant and records completion", async () => {
  expect(await (await invoke()).json()).toEqual({ outcome: "succeeded" });
  expect(mocks.mutation.mock.calls.map((c) => getFunctionName(c[0]))).toEqual([
    "accounts:block",
    "accounts:recordDisconnect",
  ]);
  expect(mocks.mutation.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.disconnect.mock.invocationCallOrder[0],
  );
  expect(mocks.disconnect).toHaveBeenCalledWith({
    ...reference.connect,
  });
});
test("completed retry never revokes again", async () => {
  mocks.mutation.mockResolvedValueOnce({
    ...reference,
    disconnectOutcome: "succeeded",
  });
  expect(await (await invoke()).json()).toEqual({ outcome: "succeeded" });
  expect(mocks.disconnect).not.toHaveBeenCalled();
});
test("metadata unavailability does not stop saved-account disconnect", async () => {
  mocks.metadata.mockResolvedValue([
    { providerId: "slack", provider: "Slack", available: false },
  ]);
  expect(
    (
      await GET(new Request("https://scope.example/api/accounts/providers"), {
        params: Promise.resolve({ operation: "providers" }),
      })
    ).status,
  ).toBe(200);
  expect((await invoke()).status).toBe(200);
  mocks.owner.mockRejectedValue(new Error("Unauthorized"));
  expect(
    (
      await GET(new Request("https://scope.example/api/accounts/providers"), {
        params: Promise.resolve({ operation: "providers" }),
      })
    ).status,
  ).toBe(401);
});
test("provisional cleanup stores recovered installation before blocking and revoking", async () => {
  mocks.query.mockResolvedValueOnce({
    ...reference,
    provisional: true,
    connect: { ...reference.connect, installationId: undefined },
  });
  mocks.inspect.mockResolvedValue({
    providerUserId: "U1",
    installationId: "installation",
    label: "Work",
    grantedScopes: reference.grantedScopes,
  });
  expect((await invoke()).status).toBe(200);
  expect(mocks.mutation.mock.calls.map((c) => getFunctionName(c[0]))).toEqual([
    "accounts:completeConnection",
    "accounts:block",
    "accounts:recordDisconnect",
  ]);
});
