// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let folder: string, path: string;
const initial = {
  origin: "https://scope.example",
  issuer: "https://issuer.example",
  clientId: "helper",
  tokens: {
    access_token: "old-private-access",
    refresh_token: "old-private-refresh",
    issuer: "https://issuer.example",
    token_type: "Bearer",
  },
  expiresAt: 1,
  tokenResource: "https://scope.example/api/mcp",
  tokenClientId: "helper",
};
beforeEach(async () => {
  vi.resetModules();
  folder = await mkdtemp(join(tmpdir(), "scope-oauth-test-"));
  path = join(folder, "config.json");
  vi.stubEnv("SCOPE_CONFIG", path);
  await writeFile(path, JSON.stringify(initial), { mode: 0o600 });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(folder, { recursive: true, force: true });
});
test("SDK refresh keeps exact resource/client/issuer and serializes simultaneous rotating refresh attempts", async () => {
  let refreshes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      const value = String(url);
      if (value.includes("oauth-protected-resource"))
        return Response.json({
          resource: initial.tokenResource,
          authorization_servers: [initial.issuer],
          scopes_supported: ["openid", "profile", "email", "offline_access"],
        });
      if (value.startsWith(initial.issuer) && value.includes(".well-known"))
        return Response.json({
          issuer: initial.issuer,
          authorization_endpoint: initial.issuer + "/oauth2/authorize",
          token_endpoint: initial.issuer + "/oauth2/token",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        });
      if (value === initial.issuer + "/oauth2/token") {
        const body = new URLSearchParams(String(options.body));
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("old-private-refresh");
        expect(body.get("client_id")).toBe("helper");
        expect(body.get("resource")).toBe(initial.tokenResource);
        expect(options.redirect).toBe("error");
        refreshes++;
        return Response.json({
          access_token: "rotated-private-access",
          refresh_token: "rotated-private-refresh",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      throw new Error("Unexpected endpoint");
    }),
  );
  const { accessToken } = await import("../plugins/scope-local/oauth.mjs");
  const results = await Promise.all([
    accessToken(),
    accessToken(),
    accessToken(),
  ]);
  expect(refreshes).toBe(1);
  expect(results.every((r) => r.accessToken === "rotated-private-access")).toBe(
    true,
  );
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved.tokens).toMatchObject({
    issuer: initial.issuer,
    refresh_token: "rotated-private-refresh",
  });
  expect(saved.tokenResource).toBe(initial.tokenResource);
  expect((await stat(path)).mode & 0o077).toBe(0);
  expect((await stat(folder)).mode & 0o077).toBe(0);
});
test("cross-issuer, client or resource sessions fail before network IO", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { accessToken } = await import("../plugins/scope-local/oauth.mjs");
  for (const change of [
    { tokenResource: "https://other.example/api/mcp" },
    { tokenClientId: "other" },
    { tokens: { ...initial.tokens, issuer: "https://other.example" } },
    { expiresAt: undefined },
  ]) {
    await writeFile(path, JSON.stringify({ ...initial, ...change }));
    await expect(accessToken()).rejects.toThrow("OAuth session belongs");
  }
  expect(fetcher).not.toHaveBeenCalled();
});
test("discovery cannot forward credentials to an unconfigured token endpoint", async () => {
  const { oauthFetch } = await import("../plugins/scope-local/oauth.mjs");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(() =>
    oauthFetch(initial)("https://attacker.example/token", {
      method: "POST",
      body: "refresh_token=private",
    }),
  ).toThrow("OAuth destination rejected");
  expect(fetcher).not.toHaveBeenCalled();
});
