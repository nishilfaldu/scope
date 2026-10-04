// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  credential: vi.fn(),
}));
vi.mock("../lib/scope-server", () => ({
  db: () => mocks,
  config: () => "service",
  scopeOrigin: () => "http://localhost:3000",
}));
vi.mock("../lib/providers", () => ({
  acquireVerifiedCredential: mocks.credential,
}));
import {
  deliverCredential,
  recordReceipt,
  requestAccess,
} from "../lib/approval-service";
const actor = {
  secret: "service",
  subject: "user_owner",
  issuer: "https://issuer.example",
  clientId: "helper",
  sessionId: "session_one",
} as Parameters<typeof deliverCredential>[0];
const id = "request" as Parameters<typeof deliverCredential>[1];
const context = {
  status: "acquire",
  accountId: "account",
  providerId: "slack",
  grantVersion: 1,
  requesterConnectionId: "native",
  approvalExpiresAt: Date.now() + 100_000,
  account: {
    connectorId: "connector",
    subjectId: "opaque",
    issuer: "https://scope.convex.site",
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue(context);
  mocks.mutation.mockResolvedValue({
    approvalExpiresAt: context.approvalExpiresAt,
    receiptProof: "private-proof",
  });
  mocks.credential.mockResolvedValue({
    accessToken: "private-provider",
    providerExpiresAt: Date.now() + 60_000,
    providerUserId: "provider",
    grantedScopes: ["channels:read"],
    tokenId: "token-id",
  });
});
test("every retry resolves fresh bytes and authorizes after provider IO without sending credentials to Convex", async () => {
  const order: string[] = [];
  mocks.credential.mockImplementation(async () => {
    order.push("provider");
    return {
      accessToken: "private-" + order.length,
      providerExpiresAt: Date.now() + 60_000,
    };
  });
  mocks.mutation.mockImplementation(async (ref) => {
    if (getFunctionName(ref) === "approvals:authorizeDelivery")
      order.push("authority");
    return {
      approvalExpiresAt: context.approvalExpiresAt,
      receiptProof: "stable",
    };
  });
  const first = await deliverCredential(actor, id),
    second = await deliverCredential(actor, id);
  expect(order).toEqual(["provider", "authority", "provider", "authority"]);
  expect(first).not.toEqual(second);
  expect(JSON.stringify(mocks.mutation.mock.calls)).not.toContain("private-");
  expect(JSON.stringify(mocks.query.mock.calls)).not.toContain("private-");
});
test("a cancellation during provider acquisition rejects the final release", async () => {
  mocks.credential.mockImplementation(async () => {
    mocks.mutation.mockRejectedValueOnce(new Error("Cancelled"));
    return {
      accessToken: "private-provider",
      providerExpiresAt: Date.now() + 60_000,
    };
  });
  await expect(deliverCredential(actor, id)).rejects.toThrow("Cancelled");
});
test("pending, expired and unavailable requests never acquire a provider token", async () => {
  for (const status of ["pending", "expired", "unavailable"]) {
    mocks.query.mockResolvedValueOnce({ status });
    expect(await deliverCredential(actor, id)).toEqual({ status });
  }
  expect(mocks.credential).not.toHaveBeenCalled();
});
test("receipt records historical evidence without re-registering a stopped client", async () => {
  await recordReceipt(actor, id, "private-proof");
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.mutation).toHaveBeenCalledOnce();
  expect(getFunctionName(mocks.mutation.mock.calls[0][0])).toBe(
    "approvals:acknowledge",
  );
});
test("request creation delegates account ownership to the authoritative mutation", async () => {
  mocks.mutation.mockImplementation(async (ref) => {
    if (getFunctionName(ref) === "approvals:request")
      throw new Error("Account unavailable");
  });
  await expect(
    requestAccess(actor, {
      key: "key-with-sixteen-chars",
      accountId: "other" as never,
      reason: "Read",
      command: {
        argv: ["node", "script.js"],
        cwd: "/tmp",
        envVar: "SLACK_TOKEN",
      },
    }),
  ).rejects.toThrow("Account unavailable");
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.mutation.mock.calls.map((c) => getFunctionName(c[0]))).toEqual([
    "clientConnections:ensure",
    "approvals:request",
  ]);
});
