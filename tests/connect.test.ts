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
  acquireCredential,
  beginAuthorization,
  configuredConnector,
  availableConnectors,
  inspectConnection,
  disconnect,
  type CredentialReference,
} from "../lib/connect";
const slack: CredentialReference = {
  connectorId: "connector-a",
  subjectId: "grant-a",
  issuer: "https://scope.convex.site",
  installationId: "install-a",
  scopes: ["channels:read"],
};
const setup = { ...slack, providerId: "slack", providerName: "Slack" };
const fetcher = vi.fn();
const identity = {
  ok: true,
  user_id: "user-a",
  team_id: "team-a",
  user: "User",
  team: "Team",
};
const token = {
  token: "opaque-provider-token",
  installationId: "install-a",
  connector: { id: "connector-a", type: "slack" },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SCOPE_SLACK_CONNECTOR", "slack");
  vi.stubGlobal("fetch", fetcher);
  sdk.metadata.mockResolvedValue({
    id: "connector-a",
    service: "slack",
    vendor: {
      userScopes: ["channels:read", "chat:write"],
      botScopes: [],
      clientSecret: "never-export-this",
    },
  });
  sdk.token.mockResolvedValue(token);
  fetcher.mockImplementation(async () =>
    Response.json(identity, {
      headers: { "x-oauth-scopes": "channels:read,identify" },
    }),
  );
});
test("delivery uses saved authorization parameters with fresh Connect resolution and no provider inspection", async () => {
  const first = await acquireCredential(slack);
  await acquireCredential(slack);
  expect(first).toEqual({ accessToken: token.token });
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
  expect(fetcher).not.toHaveBeenCalled();
  expect(sdk.metadata).not.toHaveBeenCalled();
});
test("delivery fences exact connector and installation, including an absent saved installation", async () => {
  for (const change of [
    { connector: { id: "other" } },
    { installationId: "other" },
    { installationId: "*" },
    { installationId: undefined },
    { token: "" },
  ]) {
    sdk.token.mockResolvedValueOnce({ ...token, ...change });
    await expect(acquireCredential(slack)).rejects.toMatchObject({
      kind: "grant-rejected",
    });
  }
  await expect(
    acquireCredential({ ...slack, installationId: undefined }),
  ).rejects.toMatchObject({ kind: "grant-rejected" });
  sdk.token.mockResolvedValueOnce({ ...token, installationId: undefined });
  await expect(
    acquireCredential({ ...slack, installationId: undefined, scopes: [] }),
  ).resolves.toEqual({ accessToken: token.token });
  expect(sdk.token.mock.lastCall?.[1].scopes).toEqual([]);
  for (const change of [
    { installationId: "*" },
    { scopes: ["*"] },
    { subjectId: "" },
  ]) {
    await expect(
      acquireCredential({ ...slack, ...change }),
    ).rejects.toMatchObject({ kind: "grant-rejected" });
  }
});
test("the server catalog selects trusted connector metadata and preserves configured parameters", async () => {
  const configured = await configuredConnector("slack");
  expect(configured).toEqual({
    providerId: "slack",
    provider: "Slack",
    connectorId: "connector-a",
    scopes: ["channels:read", "chat:write"],
  });
  expect(JSON.stringify(configured)).not.toContain("never-export-this");
  sdk.metadata.mockClear();
  await expect(
    configuredConnector("slack/forged-connector"),
  ).rejects.toMatchObject({ kind: "configuration-invalid" });
  expect(sdk.metadata).not.toHaveBeenCalled();
  for (const metadata of [
    { id: "c", service: "other", vendor: {} },
    { id: "c", service: "slack", vendor: { userScopes: ["*"], botScopes: [] } },
    {
      id: "c",
      service: "slack",
      vendor: { userScopes: [], botScopes: ["chat:write"] },
    },
  ]) {
    sdk.metadata.mockResolvedValueOnce(metadata);
    await expect(configuredConnector("slack")).rejects.toMatchObject({
      kind: "configuration-invalid",
    });
  }
});
test("catalog availability does not expose secrets or turn a metadata outage into lost saved accounts", async () => {
  sdk.metadata.mockRejectedValueOnce(new Error("private error"));
  expect(await availableConnectors()).toEqual([
    { providerId: "slack", provider: "Slack", available: false },
  ]);
  expect(await availableConnectors()).toEqual([
    { providerId: "slack", provider: "Slack", available: true },
  ]);
});
test("Slack setup captures actual identity and permissions rather than assuming configured scopes", async () => {
  sdk.token.mockResolvedValueOnce({
    ...token,
    token: "xoxp-setup",
    externalSubject: "user-a",
    tenantId: "team-a",
  });
  expect(await inspectConnection(setup)).toEqual({
    providerUserId: "user-a",
    providerTenantId: "team-a",
    label: "User (Team)",
    installationId: "install-a",
    grantedScopes: ["channels:read", "identify"],
  });
  expect(sdk.token.mock.calls[0][1].scopes).toEqual(["channels:read"]);
  expect(fetcher).toHaveBeenCalledOnce();
});
test("Slack setup rejects bot identity and mismatched Connect identity before activation", async () => {
  for (const grant of [
    { token: "xoxb-bot" },
    { externalSubject: "other" },
    { tenantId: "other" },
  ]) {
    sdk.token.mockResolvedValueOnce({
      ...token,
      token: "xoxp-setup",
      ...grant,
    });
    await expect(inspectConnection(setup)).rejects.toMatchObject({
      kind: "grant-rejected",
    });
  }
  sdk.token.mockResolvedValueOnce({ ...token, token: "xoxp-setup" });
  fetcher.mockResolvedValueOnce(Response.json({ ...identity, bot_id: "B1" }));
  await expect(inspectConnection(setup)).rejects.toMatchObject({
    kind: "grant-rejected",
  });
});
test("Connect-only setup requires a usable identity and reports unknown permissions honestly", async () => {
  const other = { ...slack, providerId: "example", providerName: "Example" };
  sdk.token.mockResolvedValueOnce({
    ...token,
    externalSubject: "user",
    tenantId: "tenant",
    name: "Account",
  });
  expect(await inspectConnection(other)).toMatchObject({
    providerUserId: "user",
    providerTenantId: "tenant",
    label: "Account",
    grantedScopes: [],
  });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(inspectConnection(other)).rejects.toMatchObject({
    kind: "configuration-invalid",
  });
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
  expect(await disconnect(slack)).toMatchObject({
    outcome: "failed",
    code: expect.any(String),
  });
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
    expect(await disconnect(slack)).toMatchObject({
      outcome: "failed",
      code: expect.any(String),
    });
  }
  sdk.revoke.mockClear();
  expect(await disconnect({ ...slack, installationId: "*" })).toMatchObject({
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
