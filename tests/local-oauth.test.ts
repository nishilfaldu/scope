// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
const control = vi.hoisted(() => ({
  keys: undefined as ReturnType<typeof createLocalJWKSet> | undefined,
  waits: [] as number[],
  abort: undefined as AbortController | undefined,
}));
vi.mock("../shared/authkit.mjs", async (original) => {
  const actual = await original<typeof import("../shared/authkit.mjs")>();
  return {
    ...actual,
    verifyAuthkitToken: (
      token: string,
      config: Parameters<typeof actual.verifyAuthkitToken>[1],
    ) => actual.verifyAuthkitToken(token, { ...config, keys: control.keys }),
  };
});
vi.mock("node:timers/promises", () => ({
  setTimeout: async (
    ms: number,
    _value: unknown,
    { signal }: { signal: AbortSignal },
  ) => {
    control.waits.push(ms);
    control.abort?.abort();
    signal.throwIfAborted();
  },
}));
let folder: string,
  path: string,
  pair: Awaited<ReturnType<typeof generateKeyPair>>;
const config = {
  origin: "https://scope.example",
  webClientId: "client_web",
  clientId: "client_cli",
  authkitDomain: "https://scope.authkit.app",
};
const initial = {
  ...config,
  tokens: {
    access_token: "old-private-access",
    refresh_token: "old-private-refresh",
    binding: JSON.stringify(Object.values(config)),
    subject: "user_one",
    sessionId: "session_one",
    expiresAt: 1,
  },
};
async function tokens(overrides = {}) {
  const access_token = await new SignJWT({
    sub: "user_one",
    sid: "session_one",
    client_id: config.clientId,
    ...overrides,
  })
    .setIssuer("https://api.workos.com/user_management/" + config.webClientId)
    .setExpirationTime("1h")
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(pair.privateKey);
  return {
    user: { id: "user_one" },
    access_token,
    refresh_token: "rotated-private-refresh",
  };
}
beforeEach(async () => {
  vi.resetModules();
  control.waits = [];
  control.abort = undefined;
  pair = await generateKeyPair("RS256");
  control.keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test" }],
  });
  folder = await mkdtemp(join(tmpdir(), "scope-authkit-test-"));
  path = join(folder, "config.json");
  vi.stubEnv("SCOPE_CONFIG", path);
  await writeFile(path, JSON.stringify(initial), { mode: 0o600 });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(folder, { recursive: true, force: true });
});
test("native public refresh sends no API key or secret and serializes rotating refresh across callers", async () => {
  const fresh = await tokens();
  let refreshes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      expect(String(url)).toBe(
        "https://api.workos.com/user_management/authenticate",
      );
      expect(Object.fromEntries(options.body)).toEqual({
        grant_type: "refresh_token",
        refresh_token: "old-private-refresh",
        client_id: config.clientId,
      });
      expect(options.redirect).toBe("error");
      expect(options.headers.Authorization).toBeUndefined();
      refreshes++;
      return Response.json(fresh);
    }),
  );
  const { accessToken } = await import("../cli/oauth.mjs");
  const results = await Promise.all([
    accessToken(),
    accessToken(),
    accessToken(),
  ]);
  expect(refreshes).toBe(1);
  expect(results.every((r) => r.accessToken === fresh.access_token)).toBe(true);
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved.tokens.refresh_token).toBe(fresh.refresh_token);
  expect((await stat(path)).mode & 0o077).toBe(0);
  expect((await stat(folder)).mode & 0o077).toBe(0);
});
test("changed Scope origin, environment, CLI client or hosted domain fails before network IO", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { accessToken } = await import("../cli/oauth.mjs");
  for (const change of [
    { origin: "https://other.example" },
    { webClientId: "client_other" },
    { clientId: "client_other" },
    { authkitDomain: "https://other.authkit.app" },
  ]) {
    await writeFile(path, JSON.stringify({ ...initial, ...change }));
    await expect(accessToken()).rejects.toThrow("Session belongs");
  }
  expect(fetcher).not.toHaveBeenCalled();
});
test("refresh cannot move a saved session to a different user, app or session", async () => {
  const { accessToken } = await import("../cli/oauth.mjs");
  for (const change of [
    { sub: "user_other" },
    { client_id: config.webClientId },
    { sid: "session_other" },
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(await tokens(change))),
    );
    await expect(accessToken()).rejects.toThrow();
  }
  expect(JSON.parse(await readFile(path, "utf8")).tokens.refresh_token).toBe(
    initial.tokens.refresh_token,
  );
});
test("invalid_grant clears the expired session without retrying or printing vendor fields", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: "invalid_grant", error_description: "private" },
        { status: 400 },
      ),
    ),
  );
  const { accessToken } = await import("../cli/oauth.mjs");
  await expect(accessToken()).rejects.toThrow("Sign in again");
  expect(JSON.parse(await readFile(path, "utf8")).tokens).toBeUndefined();
});
const device = {
  device_code: "private-device-code",
  user_code: "ABCD-EFGH",
  verification_uri: config.authkitDomain + "/device",
  verification_uri_complete:
    config.authkitDomain + "/device?user_code=ABCD-EFGH",
  expires_in: 300,
  interval: 1,
};
test("device pending and slow_down respect intervals, reveal only user code and save verified session", async () => {
  const fresh = await tokens();
  let poll = 0;
  const output = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      if (String(url).endsWith("authorize/device")) {
        expect(Object.fromEntries(options.body)).toEqual({
          client_id: config.clientId,
        });
        return Response.json(device);
      }
      expect(Object.fromEntries(options.body)).toEqual({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: device.device_code,
        client_id: config.clientId,
      });
      poll++;
      return poll < 3
        ? Response.json(
            { error: poll === 1 ? "authorization_pending" : "slow_down" },
            { status: 400 },
          )
        : Response.json(fresh);
    }),
  );
  const { login } = await import("../cli/oauth.mjs");
  await login({ output });
  expect(control.waits).toEqual([1000, 1000, 6000]);
  expect(JSON.stringify(output.mock.calls)).not.toMatch(
    /private-device|rotated-private|eyJ/,
  );
  expect(JSON.parse(await readFile(path, "utf8")).tokens.subject).toBe(
    "user_one",
  );
});
test("denial, expiry and cancellation stop device polling without saving a session", async () => {
  const { login } = await import("../cli/oauth.mjs");
  for (const error of ["access_denied", "expired_token"]) {
    await writeFile(path, JSON.stringify(config));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).endsWith("authorize/device")
          ? Response.json(device)
          : Response.json({ error }, { status: 400 }),
      ),
    );
    await expect(login({ output: vi.fn() })).rejects.toThrow(/denied|expired/);
    expect(JSON.parse(await readFile(path, "utf8")).tokens).toBeUndefined();
  }
  control.abort = new AbortController();
  await expect(
    login({ output: vi.fn(), signal: control.abort.signal }),
  ).rejects.toThrow("cancelled");
});
test("device response cannot direct sign-in to another environment", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...device,
        verification_uri: "https://other.authkit.app/device",
      }),
    ),
  );
  const { login } = await import("../cli/oauth.mjs");
  const output = vi.fn();
  await expect(login({ output })).rejects.toThrow("Unexpected");
  expect(output).not.toHaveBeenCalled();
});
