// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
const mocks = vi.hoisted(() => ({ mutation: vi.fn(), disconnect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../lib/scope-server", () => ({
  config: () => "private-service",
  ownerDb: async () => ({ mutation: mocks.mutation }),
  sameOrigin: vi.fn(),
  json: (body: unknown) => Response.json(body),
  safeError: () =>
    Response.json({ error: "Could not complete" }, { status: 400 }),
}));
vi.mock("../lib/providers", () => ({ disconnect: mocks.disconnect }));
import { POST } from "../app/api/accounts/[operation]/route";
const reference = {
  disconnected: false,
  connect: {
    connectorId: "connector",
    subjectId: "original-grant",
    issuer: "https://scope.example",
    installationId: "installation",
  },
  providerId: "slack",
  grantedScopes: ["identify", "channels:read"],
  grantVersion: 3,
  providerUserId: "user",
  providerTenantId: "workspace",
};
const invoke = (body: unknown = { id: "account", grantVersion: 3 }) =>
  POST(
    new Request("https://scope.example/api/accounts/disconnect", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ operation: "disconnect" }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mutation.mockImplementation(
    async (fn: FunctionReference<"mutation">) =>
      getFunctionName(fn) === "accounts:block" ? reference : "succeeded",
  );
  mocks.disconnect.mockResolvedValue({ outcome: "succeeded" });
});
test("blocks sharing before provider IO and records the original generation", async () => {
  expect(await (await invoke()).json()).toEqual({ outcome: "succeeded" });
  expect(mocks.mutation.mock.calls[0][1]).toEqual({
    id: "account",
    grantVersion: 3,
  });
  expect(mocks.mutation.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.disconnect.mock.invocationCallOrder[0],
  );
  expect(mocks.disconnect).toHaveBeenCalledWith({
    ...reference.connect,
    providerId: "slack",
    grantedScopes: reference.grantedScopes,
    providerUserId: "user",
    providerTenantId: "workspace",
  });
  expect(mocks.mutation.mock.calls[1][1]).toMatchObject({
    id: "account",
    grantVersion: 3,
    outcome: "succeeded",
  });
});
test("a completed retry does not call Connect or write another outcome", async () => {
  mocks.mutation.mockResolvedValueOnce({ ...reference, disconnected: true });
  expect(await (await invoke()).json()).toEqual({ outcome: "succeeded" });
  expect(mocks.disconnect).not.toHaveBeenCalled();
  expect(mocks.mutation).toHaveBeenCalledTimes(1);
});
test("a late provider failure cannot override another retry's confirmed completion", async () => {
  mocks.disconnect.mockResolvedValue({ outcome: "failed" });
  expect(await (await invoke()).json()).toEqual({ outcome: "succeeded" });
  expect(mocks.mutation.mock.calls[1][1]).toMatchObject({ outcome: "failed" });
});
test("malformed or stale actions stop before Connect and a record failure is surfaced", async () => {
  expect((await invoke({ id: "account" })).status).toBe(400);
  expect(mocks.mutation).not.toHaveBeenCalled();
  mocks.mutation.mockRejectedValueOnce(new Error("stale generation"));
  expect((await invoke()).status).toBe(400);
  expect(mocks.disconnect).not.toHaveBeenCalled();
  mocks.mutation
    .mockResolvedValueOnce(reference)
    .mockRejectedValueOnce(new Error("record failed"));
  expect((await invoke()).status).toBe(400);
});
