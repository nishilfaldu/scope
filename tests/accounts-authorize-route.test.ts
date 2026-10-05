// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  metadata: vi.fn(),
  authorize: vi.fn(),
  cookie: vi.fn(),
}));
vi.mock("@vercel/connect", async (original) => ({
  ...(await original<typeof import("@vercel/connect")>()),
  getConnectorMetadata: mocks.metadata,
  startAuthorization: mocks.authorize,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookie }),
}));
vi.mock("../lib/scope-server", () => ({
  config: (key: string) =>
    key === "NEXT_PUBLIC_CONVEX_SITE_URL"
      ? "https://scope.convex.site"
      : "private-service",
  ownerDb: async () => mocks,
  sameOrigin: vi.fn(),
  scopeOrigin: () => "https://scope.example",
  json: (body: unknown) => Response.json(body),
  safeError: (status = 400) => new Response(null, { status }),
  safeFailure: () =>
    Response.json({ code: "configuration-invalid" }, { status: 400 }),
}));
import { POST } from "../app/api/accounts/[operation]/route";
function invoke(body: unknown) {
  return POST(
    new Request("https://scope.example/api/accounts/authorize", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ operation: "authorize" }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SCOPE_SLACK_CONNECTOR", "server-connector");
  mocks.metadata.mockResolvedValue({
    id: "trusted-connector",
    service: "slack",
    vendor: {
      userScopes: ["channels:read"],
      botScopes: [],
      clientSecret: "never-export",
    },
  });
  mocks.mutation.mockResolvedValue({
    id: "saved-account",
    subjectId: "server-created-subject",
  });
  mocks.authorize.mockResolvedValue({ url: "https://vercel.com/consent" });
});
test("browser chooses only an allowlisted key; all Connect parameters come from the server", async () => {
  expect(await (await invoke({ providerId: "slack" })).json()).toEqual({
    url: "https://vercel.com/consent",
  });
  expect(mocks.metadata).toHaveBeenCalledWith("server-connector");
  expect(getFunctionName(mocks.mutation.mock.calls[0][0])).toBe(
    "accounts:beginConnection",
  );
  expect(mocks.mutation.mock.calls[0][1]).toMatchObject({
    providerId: "slack",
    providerName: "Slack",
    connectorId: "trusted-connector",
    requestedScopes: ["channels:read"],
    issuer: "https://scope.convex.site",
  });
  expect(mocks.authorize.mock.calls[0]).toEqual([
    "trusted-connector",
    {
      subject: {
        type: "user",
        id: "server-created-subject",
        issuer: "https://scope.convex.site",
      },
      scopes: ["channels:read"],
    },
    {
      callbackUrl:
        "https://scope.example/api/accounts/complete?setup=saved-account",
      expiresInMs: 600000,
    },
  ]);
  expect(JSON.stringify(mocks.mutation.mock.calls)).not.toContain(
    "never-export",
  );
  expect(mocks.cookie).toHaveBeenCalledOnce();
});
test("unknown keys and browser-supplied targets stop before metadata, account insertion or consent", async () => {
  for (const body of [
    { providerId: "unknown" },
    { providerId: "slack", connectorId: "forged" },
    { providerId: "slack", scopes: ["*"] },
    { providerId: "slack", subjectId: "victim" },
    { providerId: "slack", installationId: "*" },
  ])
    expect((await invoke(body)).status).toBe(400);
  expect(mocks.metadata).not.toHaveBeenCalled();
  expect(mocks.mutation).not.toHaveBeenCalled();
  expect(mocks.authorize).not.toHaveBeenCalled();
});
