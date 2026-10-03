// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Doc } from "../convex/_generated/dataModel";
const sdk = vi.hoisted(() => ({
  getTokenResponse: vi.fn(),
  mutation: vi.fn(),
}));
vi.mock("@vercel/connect", () => ({ getTokenResponse: sdk.getTokenResponse }));
vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: vi.fn(),
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = sdk.mutation;
  },
}));
vi.mock("@/config/airtable-pat-bindings.json", () => ({
  default: [
    { key: "a", label: "A", connectorId: "scl_A", baseId: "appBaseA" },
    { key: "b", label: "B", connectorId: "scl_B", baseId: "appBaseB" },
  ],
}));
import {
  airtableGrant,
  config,
  retrieve,
  sameOrigin,
} from "../lib/probe-server";
const account = (id: "A" | "B") =>
  ({
    userId: "owner",
    connectorId: `scl_${id}`,
    baseId: `appBase${id}`,
    providerUserId: `usr${id}`,
    credentialKind: "shared-pat",
    revoked: false,
  }) as Doc<"probeAccounts">;
let mismatchedIdentity = false,
  extraBase = false;
beforeEach(() => {
  vi.stubEnv("SCOPE_PAT_TEST_OWNER_ID", "owner");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://fixture.convex.cloud");
  vi.stubEnv("VERCEL_ENV", "preview");
  sdk.getTokenResponse.mockReset();
  sdk.mutation.mockReset();
  mismatchedIdentity = false;
  extraBase = false;
  sdk.getTokenResponse.mockImplementation(async (connectorId: string) => ({
    connector: { id: connectorId },
    token: `synthetic-private-${connectorId.at(-1)}`,
    expiresAt: Date.now() + 300_000,
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      const id = String(
        (options.headers as Record<string, string>).Authorization,
      ).at(-1);
      expect(options.redirect).toBe("error");
      if (url.endsWith("/whoami"))
        return Response.json({
          id: mismatchedIdentity ? "usrWrong" : `usr${id}`,
        });
      if (url.endsWith("/bases"))
        return Response.json({
          bases: [
            { id: `appBase${id}` },
            ...(extraBase ? [{ id: "appOther" }] : []),
          ],
        });
      throw new Error("Unexpected endpoint");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test("stable preview origin controls same-origin checks even on a generated deployment URL", () => {
  vi.stubEnv("SCOPE_PROBE_ORIGIN", "https://scope-preview.vercel.app");
  vi.stubEnv("VERCEL_URL", "scope-generated.vercel.app");
  expect(config("SCOPE_PROBE_ORIGIN")).toBe("https://scope-preview.vercel.app");
  expect(() =>
    sameOrigin(
      new Request("https://scope-preview.vercel.app/api/probe/pat", {
        headers: { origin: "https://scope-preview.vercel.app" },
      }),
    ),
  ).not.toThrow();
  expect(() =>
    sameOrigin(
      new Request("https://scope-generated.vercel.app/api/probe/pat", {
        headers: { origin: "https://scope-generated.vercel.app" },
      }),
    ),
  ).toThrow("Origin rejected");
  vi.stubEnv("SCOPE_PROBE_ORIGIN", "");
  expect(config("SCOPE_PROBE_ORIGIN")).toBe(
    "https://scope-generated.vercel.app",
  );
  vi.stubEnv("VERCEL_ENV", "production");
  expect(() => config("SCOPE_PROBE_ORIGIN")).toThrow(
    "Prototype disabled in production",
  );
});
test("two PAT bindings retrieve their own connector with app subject and verify distinct identities/bases", async () => {
  for (const id of ["A", "B"] as const) {
    const result = await airtableGrant(account(id));
    expect(result.providerUserId).toBe(`usr${id}`);
    expect(sdk.getTokenResponse).toHaveBeenLastCalledWith(
      `scl_${id}`,
      { subject: { type: "app" } },
      { forceRefresh: true },
    );
  }
  expect(sdk.getTokenResponse).toHaveBeenCalledTimes(2);
});
test("wrong owner and mixed connector/base metadata cannot retrieve a token", async () => {
  for (const row of [
    { ...account("A"), userId: "other" },
    { ...account("A"), baseId: "appBaseB" },
  ])
    await expect(airtableGrant(row as Doc<"probeAccounts">)).rejects.toThrow(
      "Test account unavailable",
    );
  expect(sdk.getTokenResponse).not.toHaveBeenCalled();
});
test("incorrect connector result, substituted identity and overbroad base access fail before delivery", async () => {
  sdk.getTokenResponse.mockResolvedValueOnce({
    connector: { id: "scl_B" },
    token: "synthetic",
    expiresAt: Date.now() + 300_000,
  });
  await expect(airtableGrant(account("A"))).rejects.toThrow("Invalid grant");
  mismatchedIdentity = true;
  await expect(airtableGrant(account("A"))).rejects.toThrow("Account mismatch");
  mismatchedIdentity = false;
  extraBase = true;
  await expect(airtableGrant(account("B"))).rejects.toThrow(
    "Unexpected PAT base scope",
  );
});
test("cached deliveries also require a currently allowed owner and binding", async () => {
  sdk.mutation.mockResolvedValue({
    status: "ready",
    cipher: "never-return-this",
    account: { ...account("A"), baseId: "appUnlisted" },
  });
  await expect(
    retrieve(
      {
        secret: "fixture",
        userId: "owner",
        requester: "recipient",
      } as Parameters<typeof retrieve>[0],
      "request" as Parameters<typeof retrieve>[1],
    ),
  ).rejects.toThrow("Test account unavailable");
  expect(sdk.getTokenResponse).not.toHaveBeenCalled();
});
