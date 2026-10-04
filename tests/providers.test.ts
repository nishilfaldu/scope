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
  configuredSlack,
  disconnect,
  type GrantReference,
} from "../lib/providers";
const slack: GrantReference = {
  providerId: "slack",
  connectorId: "connector-a",
  subjectId: "grant-a",
  issuer: "https://scope.convex.site",
  installationId: "install-a",
  grantedScopes: ["channels:read"],
  providerUserId: "user-a",
  providerTenantId: "team-a",
};
const fetcher = vi.fn();
const identity = {
  ok: true,
  user_id: "user-a",
  team_id: "team-a",
  user: "User",
  team: "Team",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SCOPE_SLACK_CONNECTOR", "slack");
  vi.stubGlobal("fetch", fetcher);
  sdk.metadata.mockResolvedValue({
    id: "connector-a",
    type: "slack",
    service: "slack",
    vendor: {
      userScopes: ["channels:read", "chat:write"],
      botScopes: [],
      clientSecret: "never-export-this",
    },
  });
  sdk.token.mockResolvedValue({
    token: "xoxp-private",
    installationId: "install-a",
    connector: { id: "connector-a", type: "slack" },
  });
  fetcher.mockImplementation(async () =>
    Response.json(identity, { headers: { "x-oauth-scopes": "channels:read" } }),
  );
});

test("every acquisition uses full frozen permissions, exact subject and selected installation with fresh Connect resolution", async () => {
  const first = await acquireVerifiedCredential(slack);
  sdk.token.mockResolvedValueOnce({
    token: "xoxp-private-two",
    installationId: "install-a",
    connector: { id: "connector-a", type: "slack" },
  });
  const second = await acquireVerifiedCredential(slack);
  expect(first.accessToken).not.toBe(second.accessToken);
  for (const call of sdk.token.mock.calls)
    expect(call).toEqual([
      "connector-a",
      {
        subject: {
          type: "user",
          id: "grant-a",
          issuer: "https://scope.convex.site",
        },
        scopes: ["channels:read"],
        installationId: "install-a",
      },
      { forceRefresh: true },
    ]);
  expect(JSON.stringify(first)).not.toContain("never-export-this");
  expect(first).not.toHaveProperty("providerExpiresAt");
});
test("wrong identity, workspace, missing or broader effective scopes reject before release", async () => {
  for (const [body, scopes] of [
    [{ ...identity, user_id: "other" }, "channels:read"],
    [{ ...identity, team_id: "other" }, "channels:read"],
    [identity, ""],
    [identity, "channels:read,chat:write"],
    [{ ...identity, bot_id: "bot" }, "channels:read"],
  ] as const) {
    fetcher.mockResolvedValueOnce(
      Response.json(body, { headers: { "x-oauth-scopes": scopes } }),
    );
    await expect(acquireVerifiedCredential(slack)).rejects.toMatchObject({
      kind: "grant-rejected",
    });
  }
});
test("wrong installation and rotating tokens cannot silently pass the supported user-grant flow", async () => {
  await expect(
    acquireVerifiedCredential({ ...slack, installationId: "*" }),
  ).rejects.toMatchObject({ kind: "grant-rejected" });
  for (const change of [
    { installationId: "install-b" },
    { token: "xoxe.xoxp-rotating" },
    { token: "xoxb-bot" },
  ]) {
    sdk.token.mockResolvedValueOnce({
      token: "xoxp-private",
      installationId: "install-a",
      connector: { id: "connector-a", type: "slack" },
      ...change,
    });
    await expect(acquireVerifiedCredential(slack)).rejects.toMatchObject({
      kind: change.token?.startsWith("xoxe.")
        ? "revocation-unavailable"
        : "grant-rejected",
    });
  }
});
test("disconnect requires actual Slack revocation and invalidation before deleting only the selected Connect grant", async () => {
  fetcher
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(Response.json({ ok: true, revoked: true }))
    .mockResolvedValueOnce(
      Response.json({ ok: false, error: "token_revoked" }),
    );
  expect(await disconnect(slack)).toEqual({ outcome: "succeeded" });
  expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
    "https://slack.com/api/auth.test",
    "https://slack.com/api/auth.revoke",
    "https://slack.com/api/auth.test",
  ]);
  expect(sdk.revoke).toHaveBeenCalledWith("connector-a", {
    subject: {
      type: "user",
      id: "grant-a",
      issuer: "https://scope.convex.site",
    },
    installationId: "install-a",
  });
});
test("SDK success alone is not proof of upstream disconnect; an active bearer or provider outage retains retry state", async () => {
  fetcher
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(Response.json({ ok: true, revoked: true }))
    .mockResolvedValueOnce(Response.json(identity));
  expect(await disconnect(slack)).toEqual({ outcome: "failed" });
  expect(sdk.revoke).not.toHaveBeenCalled();
  fetcher.mockRejectedValueOnce(new Error("private-provider-error"));
  expect(await disconnect(slack)).toEqual({ outcome: "failed" });
});
test("disconnect retries can finish after provider revoke succeeded and Connect deletion failed", async () => {
  fetcher.mockImplementation(async () =>
    Response.json({ ok: false, error: "token_revoked" }),
  );
  expect(await disconnect(slack)).toEqual({ outcome: "succeeded" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("authorization uses selected connection permissions and obtains its first installation through consent", async () => {
  sdk.authorize.mockResolvedValue({ url: "https://provider.example/consent" });
  expect(
    await beginAuthorization(
      { ...slack, installationId: undefined },
      "http://localhost:3000/api/accounts/complete",
    ),
  ).toEqual({ url: "https://provider.example/consent" });
  expect(sdk.authorize.mock.calls[0][1]).toEqual({
    subject: {
      type: "user",
      id: "grant-a",
      issuer: "https://scope.convex.site",
    },
    scopes: ["channels:read"],
  });
  sdk.authorize.mockResolvedValue({ url: "http://provider.example/consent" });
  await expect(
    beginAuthorization(slack, "http://localhost:3000/api/accounts/complete"),
  ).rejects.toMatchObject({ kind: "configuration-invalid" });
});

test("setup displays Slack's baseline identity scope without requesting it from Connect", async () => {
  expect(await configuredSlack()).toEqual({
    connectorId: "connector-a",
    scopes: ["channels:read", "chat:write", "identify"],
  });
  fetcher.mockResolvedValueOnce(
    Response.json(identity, {
      headers: { "x-oauth-scopes": "identify,channels:read" },
    }),
  );
  expect(
    (
      await acquireVerifiedCredential({
        ...slack,
        grantedScopes: ["channels:read", "identify"],
      })
    ).grantedScopes,
  ).toEqual(["channels:read", "identify"]);
  expect(sdk.token.mock.calls[0][1].scopes).toEqual(["channels:read"]);
  expect(sdk.metadata).toHaveBeenCalledTimes(1);
});
