// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { POST } from "../app/api/connect/bridge/route";
import { CONNECT_SLACK_SCOPES as SLACK_SCOPES } from "../convex/connect/contracts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
test("installed SDK uses project OIDC, explicit subject/scopes, bypasses cache, and revokes the selected installation", async () => {
  const secret = "test-secret-with-at-least-32-characters";
  const oidc = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
  vi.stubEnv("VERCEL_OIDC_TOKEN", oidc);
  vi.stubEnv("VERCEL_REGION", "");
  vi.stubEnv("VERCEL_CONNECT_INTERACTIVE_AUTH_MODE", "");
  vi.stubEnv("CONNECT_BRIDGE_SECRET", secret);
  vi.stubEnv("CONNECT_SLACK_CONNECTOR", "slack/scope");
  vi.stubEnv("SCOPE_CONVEX_SITE_URL", "https://scope.convex.site");
  vi.stubEnv("SCOPE_BOARD_ORIGIN", "https://scope.example.com");
  const ref = {
    subjectId: "scope:owner:slot",
    issuer: "https://scope.convex.site",
    connectorId: "scl_slack",
    installationId: "inst_T1",
  };
  let operation: "authorize" | "token" | "revoke" = "authorize";
  let tokens = 0;
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method;
      const headers = new Headers(init?.headers);
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (url === "https://scope.convex.site/api/connect/ticket") {
        expect(headers.get("authorization")).toBe(`Bearer ${secret}`);
        return Response.json(
          operation === "revoke"
            ? { operation, reference: ref }
            : operation === "authorize"
              ? {
                  operation,
                  subjectId: ref.subjectId,
                  issuer: ref.issuer,
                  state: "12345678-1234-1234-1234-123456789abc",
                }
              : { operation, ...ref, providerUserId: "T1:U1" },
        );
      }
      if (url.startsWith("https://api.vercel.com/")) {
        expect(headers.get("authorization")).toBe(`Bearer ${oidc}`);
        if (url.endsWith("/connectors/slack%2Fscope"))
          return Response.json({
            id: "scl_slack",
            uid: "slack/scope",
            type: "slack",
            service: "slack",
            name: "Scope",
            data: {},
          });
        expect(body.subject).toEqual({
          type: "user",
          id: ref.subjectId,
          issuer: ref.issuer,
        });
        if (url.endsWith("/authorize/scl_slack")) {
          expect(method).toBe("POST");
          expect(body.scopes).toEqual(SLACK_SCOPES);
          expect(body.returnUrl).toBe(
            "https://scope.example.com/oauth/complete?app=slack&state=12345678-1234-1234-1234-123456789abc&code=connect",
          );
          return Response.json({
            url: "https://vercel.com/connect/authorize",
            request: "request",
            verifier: "verifier",
          });
        }
        if (url.endsWith("/token/scl_slack")) {
          expect(method).toBe("POST");
          expect(body.scopes).toEqual(SLACK_SCOPES);
          expect(body.installationId).toBe("inst_T1");
          tokens++;
          return Response.json({
            token: `xoxe.xoxp-${tokens}`,
            expiresAt: Date.now() + 3600_000,
            installationId: "inst_T1",
            connector: { id: "scl_slack", type: "slack", uid: "slack/scope" },
          });
        }
        if (url.endsWith("/connectors/scl_slack/tokens")) {
          expect(method).toBe("DELETE");
          expect(body.installationId).toBe("inst_T1");
          return new Response(null, { status: 204 });
        }
      }
      if (url === "https://slack.com/api/auth.test")
        return Response.json(
          { ok: true, team_id: "T1", user_id: "U1" },
          { headers: { "x-oauth-scopes": "chat:write" } },
        );
      throw new Error(`Unexpected SDK request ${url}`);
    });
  const invoke = () =>
    POST(
      new Request("https://scope.example.com/api/connect/bridge", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: JSON.stringify({ ticket: `cb_${"f".repeat(64)}` }),
      }),
    );
  expect((await invoke()).status).toBe(200);
  operation = "token";
  expect(await (await invoke()).json()).toMatchObject({
    accessToken: "xoxe.xoxp-1",
    providerUserId: "T1:U1",
  });
  expect(await (await invoke()).json()).toMatchObject({
    accessToken: "xoxe.xoxp-2",
  });
  expect(tokens).toBe(2);
  operation = "revoke";
  expect((await invoke()).status).toBe(200);
  expect(transport).toHaveBeenCalled();
});
