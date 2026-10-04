import { beforeEach, expect, test, vi } from "vitest";
import {
  ConnectError,
  NoValidTokenError,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
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
test("wrong installations and bot tokens cannot pass the user-grant flow", async () => {
  await expect(
    acquireVerifiedCredential({ ...slack, installationId: "*" }),
  ).rejects.toMatchObject({ kind: "grant-rejected" });
  for (const change of [
    { installationId: "install-b" },
    { token: "xoxb-bot" },
  ]) {
    sdk.token.mockResolvedValueOnce({
      token: "xoxp-private",
      installationId: "install-a",
      connector: { id: "connector-a", type: "slack" },
      ...change,
    });
    await expect(acquireVerifiedCredential(slack)).rejects.toMatchObject({
      kind: "grant-rejected",
    });
  }
});
test("rotating user credentials retain the same identity and scope checks", async () => {
  sdk.token.mockResolvedValueOnce({
    token: "xoxe.xoxp-rotating",
    installationId: "install-a",
    connector: { id: "connector-a", type: "slack" },
  });
  expect((await acquireVerifiedCredential(slack)).accessToken).toBe(
    "xoxe.xoxp-rotating",
  );
});
test("disconnect uses only Connect for the exact original subject and installation", async () => {
  expect(await disconnect(slack)).toEqual({ outcome: "succeeded" });
  expect(sdk.token).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(sdk.revoke).toHaveBeenCalledWith("connector-a", {
    subject: {
      type: "user",
      id: "grant-a",
      issuer: "https://scope.convex.site",
    },
    installationId: "install-a",
  });
});
test("a failed or lost Connect response retries the same target without fetching a deleted token", async () => {
  sdk.revoke.mockRejectedValueOnce(new Error("response lost"));
  expect(await disconnect(slack)).toEqual({ outcome: "failed" });
  expect(await disconnect(slack)).toEqual({ outcome: "succeeded" });
  expect(sdk.revoke.mock.calls[0]).toEqual(sdk.revoke.mock.calls[1]);
  expect(sdk.token).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
test("only an explicit absent user authorization is completion; configuration and provider failures stay errors", async () => {
  sdk.revoke.mockRejectedValueOnce(
    new UserAuthorizationRequiredError("absent", {
      status: 404,
      code: "user_authorization_required",
    }),
  );
  expect(await disconnect(slack)).toEqual({ outcome: "succeeded" });
  for (const error of [
    new ConnectError("missing connector", { status: 404, code: "not_found" }),
    new ConnectError("forbidden", { status: 403, code: "forbidden" }),
    new NoValidTokenError("provider unavailable", {
      status: 400,
      code: "no_token",
    }),
    new UserAuthorizationRequiredError("authentication failure", {
      status: 401,
      code: "user_authorization_required",
    }),
    new Error("network unavailable"),
  ]) {
    sdk.revoke.mockRejectedValueOnce(error);
    expect(await disconnect(slack)).toEqual({ outcome: "failed" });
  }
  sdk.revoke.mockClear();
  expect(await disconnect({ ...slack, installationId: "*" })).toEqual({
    outcome: "failed",
  });
  expect(sdk.revoke).not.toHaveBeenCalled();
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
