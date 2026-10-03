// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { patBindings } from "../lib/probe-pat-bindings";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  grant: vi.fn(),
  ownerId: "owner",
  existing: false,
}));
vi.mock("../lib/probe-server", () => ({
  config: (name: string) =>
    name === "SCOPE_PAT_TEST_OWNER_ID"
      ? "owner"
      : name === "SCOPE_PROBE_SECRET"
        ? "private-bridge"
        : "https://fixture.convex.site",
  ownerDb: async () => ({ query: mocks.query, mutation: mocks.mutation }),
  sameOrigin: () => {},
  json: (data: unknown) => Response.json(data),
  safeError: () => Response.json({ error: "Unavailable" }, { status: 400 }),
  airtableGrant: mocks.grant,
  db: vi.fn(),
  requester: vi.fn(),
  retrieve: vi.fn(),
  unseal: vi.fn(),
}));
vi.mock("../lib/probe-push", () => ({ notifyApproval: vi.fn() }));
vi.mock("@vercel/connect", () => ({
  startAuthorization: vi.fn(),
  revokeToken: vi.fn(),
}));
import { POST } from "../app/api/probe/[operation]/route";
const invoke = (operation: string, body: unknown = {}) =>
  POST(
    new Request("https://scope.example/api/probe/" + operation, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ operation }) },
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ownerId = "owner";
  mocks.existing = false;
  const binding = patBindings[1];
  const row = {
    _id: "account-b",
    credentialKind: "shared-pat",
    revoked: false,
    ...binding,
  };
  mocks.query.mockImplementation(async (ref) => {
    switch (getFunctionName(ref)) {
      case "probe:identity":
        return { id: mocks.ownerId };
      case "probe:accountsForOwner":
        return mocks.existing ? [row] : [];
      case "probe:account":
        return row;
      default:
        throw new Error("Unexpected query");
    }
  });
  mocks.mutation.mockResolvedValue("account-b");
  mocks.grant.mockResolvedValue({
    providerUserId: "usrB",
    expiresAt: Date.now() + 60_000,
  });
});
test("only the pinned Scope owner can list or register named PAT bindings", async () => {
  expect(await (await invoke("pat-bindings")).json()).toEqual({
    bindings: patBindings.map(({ key, label }) => ({ key, label })),
  });
  mocks.ownerId = "someone-else";
  expect((await invoke("pat-bindings")).status).toBe(400);
  expect((await invoke("pat", { bindingKey: patBindings[1].key })).status).toBe(
    400,
  );
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.mutation).not.toHaveBeenCalled();
});
test("registration selects B from server metadata and ignores caller connector/base substitutions", async () => {
  const binding = patBindings[1];
  expect(
    (
      await invoke("pat", {
        bindingKey: binding.key,
        connectorId: patBindings[0].connectorId,
        baseId: patBindings[0].baseId,
      })
    ).status,
  ).toBe(200);
  const create = mocks.mutation.mock.calls.find(
    ([ref]) => getFunctionName(ref) === "probe:addAccount",
  );
  expect(create?.[1]).toMatchObject({
    connectorId: binding.connectorId,
    baseId: binding.baseId,
    label: binding.label,
    credentialKind: "shared-pat",
    secret: "private-bridge",
  });
  mocks.mutation.mockClear();
  mocks.existing = true;
  expect((await invoke("pat", { bindingKey: binding.key })).status).toBe(200);
  expect(
    mocks.mutation.mock.calls.some(
      ([ref]) => getFunctionName(ref) === "probe:addAccount",
    ),
  ).toBe(false);
});
test("unknown binding or missing selection cannot fall back to account A", async () => {
  for (const body of [
    {},
    { bindingKey: "unknown" },
    { connectorId: patBindings[0].connectorId },
  ])
    expect((await invoke("pat", body)).status).toBe(400);
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.mutation).not.toHaveBeenCalled();
});
