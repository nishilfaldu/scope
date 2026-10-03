// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  grant: vi.fn(),
  proof: "private-browser-proof",
  disconnect: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.proof ? { value: mocks.proof } : undefined),
  }),
}));
vi.mock("../lib/scope-server", () => ({
  config: (name: string) =>
    name === "SCOPE_ORIGIN" ? "https://scope.example" : "private-service",
  ownerDb: async () => ({ query: mocks.query, mutation: mocks.mutation }),
  scopeOrigin: () => "https://scope.example",
}));
vi.mock("../lib/providers", () => ({
  acquireVerifiedCredential: mocks.grant,
  disconnect: mocks.disconnect,
}));
import { GET } from "../app/api/accounts/complete/route";
const invoke = (extra = "") =>
  GET(
    new Request(
      "https://scope.example/api/accounts/complete?attempt=abc123" + extra,
    ),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.proof = "private-browser-proof";
  mocks.query.mockResolvedValue({
    id: "abc123",
    integrationId: "airtable-rest-read",
    profileId: "bases.read",
    profileVersion: 1,
    connect: {
      connectorId: "connector",
      subjectId: "unique-subject",
      issuer: "https://scope.convex.site",
    },
    expiresAt: Date.now() + 600_000,
    proofHash: createHash("sha256").update(mocks.proof).digest("hex"),
  });
  mocks.grant.mockResolvedValue({
    providerUserId: "usr-verified",
    providerEmail: "owner@example.com",
    installationId: "install-verified",
  });
  mocks.mutation.mockResolvedValue({ accountId: "account" });
});
test("only verified success completes the account and redirects to connections", async () => {
  const response = await invoke();
  expect(response.headers.get("location")).toBe(
    "https://scope.example/connections?connection=connected",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.mutation.mock.calls[0][1]).toMatchObject({
    id: "abc123",
    providerUserId: "usr-verified",
    installationId: "install-verified",
  });
  expect(response.headers.get("set-cookie")).toBeNull(); // Proof survives identical callback retries until fixed expiry.
});
test("provider failure or cancelled sign-in cannot save an account", async () => {
  mocks.grant.mockRejectedValue(new Error("Provider mismatch"));
  expect((await invoke()).headers.get("location")).toContain(
    "connection=failed",
  );
  expect(mocks.mutation).not.toHaveBeenCalled();
  mocks.grant.mockClear();
  expect(
    (await invoke("&error=access_denied")).headers.get("location"),
  ).toContain("connection=failed");
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.mutation).not.toHaveBeenCalled();
});
test("missing proof, wrong proof, owner rejection and expiry fail before provider IO", async () => {
  mocks.proof = "";
  await invoke();
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.proof = "different";
  mocks.query.mockRejectedValueOnce(new Error("Invalid proof"));
  await invoke();
  mocks.query.mockRejectedValueOnce(new Error("Connection unavailable"));
  await invoke();
  mocks.query.mockResolvedValueOnce({
    expiresAt: Date.now() - 1,
    proofHash: createHash("sha256").update(mocks.proof).digest("hex"),
  });
  await invoke();
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.mutation).not.toHaveBeenCalled();
});
test("completed retries check the bound account without another provider call or write", async () => {
  const original = await mocks.query();
  mocks.query.mockResolvedValueOnce({ ...original, accountId: "account" });
  expect((await invoke()).headers.get("location")).toContain(
    "connection=connected",
  );
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.mutation).not.toHaveBeenCalled();
  mocks.query.mockRejectedValueOnce(new Error("Blocked completed account"));
  expect((await invoke()).headers.get("location")).toContain(
    "connection=failed",
  );
});

test("retried completion performs pending superseded cleanup and only acknowledges success", async () => {
  mocks.query.mockResolvedValue({
    id: "abc123",
    accountId: "account",
    expiresAt: Date.now() + 600_000,
    superseded: {
      integrationId: "airtable-rest-read",
      profileId: "bases.read",
      profileVersion: 1,
      connect: {
        connectorId: "connector",
        subjectId: "old-subject",
        issuer: "https://scope.convex.site",
      },
    },
  });
  mocks.disconnect.mockResolvedValueOnce({ outcome: "failed" });
  expect((await invoke()).headers.get("location")).toContain(
    "connection=connected",
  );
  expect(mocks.mutation).not.toHaveBeenCalled();
  mocks.disconnect.mockResolvedValueOnce({ outcome: "succeeded" });
  await invoke();
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.mutation.mock.calls[0][1]).toMatchObject({
    id: "abc123",
    subjectId: "old-subject",
    outcome: "succeeded",
  });
});
