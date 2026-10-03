import { beforeEach, expect, test, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  metadata: vi.fn(),
  token: vi.fn(),
  authorize: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@vercel/connect", async (original) => ({
  ...(await original<typeof import("@vercel/connect")>()),
  getConnectorMetadata: sdk.metadata,
  getTokenResponse: sdk.token,
  startAuthorization: sdk.authorize,
  revokeToken: sdk.revoke,
}));
import {
  acquireVerifiedCredential,
  beginAuthorization,
  disconnect,
  ProviderFailure,
  type GrantReference,
} from "../lib/providers";
const airtable: GrantReference = {
  integrationId: "airtable-rest-read",
  connectorId: "connector-a",
  subjectId: "grant-a",
  issuer: "https://scope.convex.site",
  profileId: "bases.read",
  profileVersion: 1,
  providerUserId: "user-a",
};
const fetcher = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SCOPE_AIRTABLE_REST_CONNECTOR", "airtable-rest");
  vi.stubEnv("SCOPE_SLACK_CONNECTOR", "slack");
  vi.stubGlobal("fetch", fetcher);
  sdk.metadata.mockResolvedValue({
    id: "connector-a",
    type: "oauth",
    service: "airtable",
    vendor: { clientSecret: "never-export-this" },
  });
  sdk.token.mockResolvedValue({
    token: "private-token-one",
    expiresAt: Date.now() + 600_000,
    connector: { id: "connector-a", type: "oauth" },
  });
  fetcher.mockImplementation(async () =>
    Response.json({ id: "user-a", scopes: ["schema.bases:read"] }),
  );
});
test("custom OAuth needs no installation, requests a fixed profile, and bypasses process cache on every attempt", async () => {
  const first = await acquireVerifiedCredential(airtable);
  sdk.token.mockResolvedValueOnce({
    token: "private-token-two",
    expiresAt: Date.now() + 600_000,
    connector: { id: "connector-a", type: "oauth" },
  });
  const second = await acquireVerifiedCredential(airtable);
  expect(first.accessToken).not.toBe(second.accessToken);
  expect(first.providerUserId).toBe(second.providerUserId);
  for (const call of sdk.token.mock.calls)
    expect(call).toEqual([
      "connector-a",
      {
        subject: {
          type: "user",
          id: "grant-a",
          issuer: "https://scope.convex.site",
        },
        scopes: ["schema.bases:read"],
      },
      { forceRefresh: true },
    ]);
  expect(JSON.stringify(first)).not.toContain("never-export-this");
});
test("same provider identity under distinct selected grants keeps separate Connect subjects", async () => {
  await acquireVerifiedCredential(airtable);
  await acquireVerifiedCredential({ ...airtable, subjectId: "grant-b" });
  expect(sdk.token.mock.calls.map((call) => call[1].subject.id)).toEqual([
    "grant-a",
    "grant-b",
  ]);
});
test("MCP-targeted connectors are rejected before REST credential acquisition", async () => {
  sdk.metadata.mockResolvedValue({
    id: "connector-a",
    type: "oauth",
    service: "airtable",
    vendor: {
      serverUrl: "https://mcp.airtable.com/mcp",
      clientSecret: "private-config",
    },
  });
  await expect(acquireVerifiedCredential(airtable)).rejects.toMatchObject({
    kind: "configuration-invalid",
  });
  expect(sdk.token).not.toHaveBeenCalled();
});
test("wrong identity, omitted scope evidence and broader permissions reject the grant", async () => {
  for (const body of [
    { id: "user-b", scopes: ["schema.bases:read"] },
    { id: "user-a" },
    { id: "user-a", scopes: ["schema.bases:read", "data.records:write"] },
  ]) {
    fetcher.mockResolvedValueOnce(Response.json(body));
    await expect(acquireVerifiedCredential(airtable)).rejects.toMatchObject({
      kind: "grant-rejected",
    });
  }
});
test("changed profile, selected installation or expired credential never passes verification", async () => {
  await expect(
    acquireVerifiedCredential({ ...airtable, profileVersion: 2 }),
  ).rejects.toMatchObject({ kind: "grant-rejected" });
  await expect(
    acquireVerifiedCredential({ ...airtable, installationId: "*" }),
  ).rejects.toMatchObject({ kind: "grant-rejected" });
  sdk.token.mockResolvedValueOnce({
    token: "expired",
    expiresAt: Date.now(),
    connector: { id: "connector-a", type: "oauth" },
  });
  await expect(acquireVerifiedCredential(airtable)).rejects.toMatchObject({
    kind: "grant-rejected",
  });
});
test("Slack requires its selected installation, verified user/tenant and bounded rotated token", async () => {
  const slack = {
    ...airtable,
    integrationId: "slack-read",
    profileId: "channels.read",
    installationId: "install-a",
    providerUserId: "user-a",
    providerTenantId: "team-a",
  };
  sdk.metadata.mockResolvedValue({
    id: "connector-a",
    type: "slack",
    service: "slack",
    vendor: {},
  });
  sdk.token.mockResolvedValue({
    token: "xoxe.xoxp-private",
    expiresAt: Date.now() + 600_000,
    installationId: "install-a",
    connector: { id: "connector-a", type: "slack" },
  });
  fetcher.mockImplementation(async () =>
    Response.json(
      {
        ok: true,
        user_id: "user-a",
        team_id: "team-a",
        user: "User",
        team: "Team",
      },
      { headers: { "x-oauth-scopes": "channels:read" } },
    ),
  );
  expect(await acquireVerifiedCredential(slack)).toMatchObject({
    providerUserId: "user-a",
    providerTenantId: "team-a",
    installationId: "install-a",
  });
  await expect(
    acquireVerifiedCredential({ ...slack, installationId: undefined }),
  ).rejects.toMatchObject({ kind: "grant-rejected" });
  sdk.token.mockResolvedValueOnce({
    token: "xoxe.xoxp-private",
    expiresAt: Date.now() + 600_000,
    installationId: "install-b",
    connector: { id: "connector-a", type: "slack" },
  });
  await expect(acquireVerifiedCredential(slack)).rejects.toMatchObject({
    kind: "grant-rejected",
  });
  await expect(
    acquireVerifiedCredential({ ...slack, providerTenantId: "team-b" }),
  ).rejects.toMatchObject({ kind: "grant-rejected" });
});
test("Connect revocation success records only Connect success and never bearer recall", async () => {
  sdk.revoke.mockResolvedValue(undefined);
  expect(await disconnect(airtable)).toEqual({ outcome: "succeeded" });
  expect(sdk.revoke).toHaveBeenCalledWith("connector-a", {
    subject: {
      type: "user",
      id: "grant-a",
      issuer: "https://scope.convex.site",
    },
  });
  sdk.revoke.mockRejectedValue(new Error("private-vendor-error"));
  expect(await disconnect(airtable)).toEqual({ outcome: "failed" });
});
test("provider failures expose a normalized reason without vendor details", async () => {
  fetcher.mockResolvedValueOnce(
    new Response("private-provider-error", { status: 401 }),
  );
  const error = await acquireVerifiedCredential(airtable).catch(
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(ProviderFailure);
  expect(error).toMatchObject({ kind: "reauthorization-required" });
  expect(String(error)).not.toContain("private-provider-error");
});
test("authorization never invents an installation and pins its returned destination to HTTPS", async () => {
  sdk.authorize.mockResolvedValue({ url: "https://provider.example/consent" });
  expect(
    await beginAuthorization(
      airtable,
      "http://localhost:3000/api/accounts/complete",
    ),
  ).toEqual({ url: "https://provider.example/consent" });
  expect(sdk.authorize.mock.calls[0][1]).not.toHaveProperty("installationId");
  sdk.authorize.mockResolvedValue({ url: "http://provider.example/consent" });
  await expect(
    beginAuthorization(airtable, "http://localhost:3000/api/accounts/complete"),
  ).rejects.toMatchObject({ kind: "configuration-invalid" });
});
