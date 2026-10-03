// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  grant: vi.fn(),
  proof: "private-browser-proof",
  cancelled: false,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.proof ? { value: mocks.proof } : undefined),
  }),
}));
vi.mock("../lib/probe-server", () => ({
  config: (name: string) =>
    name === "SCOPE_PROBE_ORIGIN" ? "https://scope.example" : "private-service",
  ownerDb: async () => ({ query: mocks.query, mutation: mocks.mutation }),
  airtableGrant: mocks.grant,
}));
import { GET } from "../app/api/probe/complete/route";
const invoke = (extra = "") =>
  GET(
    new Request(
      "https://scope.example/api/probe/complete?attempt=abc123" + extra,
    ),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.proof = "private-browser-proof";
  mocks.query.mockResolvedValue({
    _id: "abc123",
    userId: "owner",
    connectorId: "connector",
    subjectId: "unique-subject",
    issuer: "https://scope.example",
    expiresAt: Date.now() + 600_000,
    proofHash: createHash("sha256").update(mocks.proof).digest("hex"),
  });
  mocks.grant.mockResolvedValue({
    providerUserId: "usr-verified",
    providerEmail: "owner@example.com",
    installationId: "install-verified",
  });
  mocks.mutation.mockResolvedValue("account");
});
test("only verified success completes the account and redirects to connections", async () => {
  const response = await invoke();
  expect(response.headers.get("location")).toBe(
    "https://scope.example/connections?airtable=connected",
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
  expect((await invoke()).headers.get("location")).toContain("airtable=failed");
  expect(mocks.mutation).not.toHaveBeenCalled();
  mocks.grant.mockClear();
  expect(
    (await invoke("&error=access_denied")).headers.get("location"),
  ).toContain("airtable=failed");
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.mutation).not.toHaveBeenCalled();
});
test("missing proof, wrong proof, owner rejection and expiry fail before provider IO", async () => {
  mocks.proof = "";
  await invoke();
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.proof = "different";
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
  mocks.query
    .mockResolvedValueOnce({ ...original, accountId: "account" })
    .mockResolvedValueOnce({ revoked: false });
  expect((await invoke()).headers.get("location")).toContain(
    "airtable=connected",
  );
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.mutation).not.toHaveBeenCalled();
  mocks.query
    .mockResolvedValueOnce({ ...original, accountId: "account" })
    .mockResolvedValueOnce({ revoked: true });
  expect((await invoke()).headers.get("location")).toContain("airtable=failed");
});
