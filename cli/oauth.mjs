import {
  readFile,
  writeFile,
  rename,
  stat,
  lstat,
  mkdir,
  rm,
  chmod,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { authkitIssuer, verifyAuthkitToken } from "../shared/authkit.mjs";
export const configPath =
  process.env.SCOPE_CONFIG ??
  join(homedir(), ".config", "scope", "config.json");
function origin(value, local = false) {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(local && url.protocol === "http:" && url.hostname === "localhost")) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Invalid origin");
  return url.origin;
}
export async function loadConfig() {
  const [info, parent] = await Promise.all([
    lstat(configPath),
    stat(dirname(configPath)),
  ]);
  if (
    !info.isFile() ||
    info.mode & 0o077 ||
    parent.mode & 0o077 ||
    info.uid !== process.getuid?.() ||
    parent.uid !== process.getuid?.()
  )
    throw new Error(
      "Scope configuration must be owned by you with private permissions.",
    );
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.origin = origin(config.origin, true);
  config.authkitDomain = origin(config.authkitDomain);
  authkitIssuer(config.webClientId);
  if (
    !/^client_[A-Za-z0-9]+$/.test(config.clientId) ||
    config.clientSecret ||
    config.apiKey
  )
    throw new Error("Configure the public Scope CLI application.");
  const binding = sessionBinding(config);
  if (
    config.tokens &&
    (config.tokens.binding !== binding ||
      !Number.isFinite(config.tokens.expiresAt) ||
      !config.tokens.access_token ||
      !config.tokens.refresh_token ||
      !/^user_[A-Za-z0-9]+$/.test(config.tokens.subject) ||
      !/^session_[A-Za-z0-9]+$/.test(config.tokens.sessionId))
  )
    throw new Error("Session belongs to another configuration. Sign in again.");
  return config;
}
function sessionBinding(config) {
  return JSON.stringify([
    config.origin,
    config.webClientId,
    config.clientId,
    config.authkitDomain,
  ]);
}
export async function saveConfig(config) {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(configPath), 0o700);
  const temporary = configPath + "." + randomBytes(12).toString("hex");
  try {
    await writeFile(temporary, JSON.stringify(config), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, configPath);
  } finally {
    await rm(temporary, { force: true });
  }
}
// Serialize login/refresh across CLI processes so rotating refresh tokens cannot race.
export async function withConfigLock(work) {
  await loadConfig();
  const release = await lockfile.lock(configPath, {
    retries: { retries: 300, factor: 1, minTimeout: 100, maxTimeout: 100 },
  });
  try {
    return await work();
  } finally {
    await release();
  }
}

const API = "https://api.workos.com/user_management/";
async function post(endpoint, parameters, signal) {
  const response = await fetch(API + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(signal ? [signal] : []),
    ]),
  });
  return { response, data: await response.json().catch(() => ({})) };
}
async function storeTokens(config, data, previous) {
  if (
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string" ||
    !data.refresh_token
  )
    throw new Error("Invalid AuthKit session");
  const verified = await verifyAuthkitToken(data.access_token, config);
  if (
    data.user?.id !== verified.subject ||
    (previous &&
      (previous.subject !== verified.subject ||
        previous.sessionId !== verified.sessionId))
  )
    throw new Error("AuthKit session changed. Sign in again.");
  config.tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    binding: sessionBinding(config),
    subject: verified.subject,
    sessionId: verified.sessionId,
    expiresAt: verified.expiresAt,
  };
  await saveConfig(config);
}
export async function accessToken() {
  return withConfigLock(async () => {
    const config = await loadConfig();
    if (!config.tokens) throw new Error("Run scope login first.");
    if (config.tokens.expiresAt <= Date.now() + 30_000) {
      const { response, data } = await post("authenticate", {
        grant_type: "refresh_token",
        refresh_token: config.tokens.refresh_token,
        client_id: config.clientId,
      });
      if (!response.ok) {
        if (data.error === "invalid_grant") {
          delete config.tokens;
          await saveConfig(config);
        }
        throw new Error("Scope session could not be refreshed. Sign in again.");
      }
      await storeTokens(config, data, config.tokens);
    }
    const verified = await verifyAuthkitToken(
      config.tokens.access_token,
      config,
    );
    if (
      verified.subject !== config.tokens.subject ||
      verified.sessionId !== config.tokens.sessionId
    )
      throw new Error("AuthKit session changed. Sign in again.");
    return { origin: config.origin, accessToken: config.tokens.access_token };
  });
}
function verificationUrl(value, domain) {
  const url = new URL(value);
  if (
    url.origin !== domain ||
    url.pathname !== "/device" ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Unexpected AuthKit verification page");
  return url.toString();
}
export async function login({ output = console.log, signal } = {}) {
  return withConfigLock(async () => {
    signal?.throwIfAborted();
    const config = await loadConfig();
    const { response, data } = await post(
      "authorize/device",
      { client_id: config.clientId },
      signal,
    );
    let interval = data.interval ?? 5;
    if (
      !response.ok ||
      typeof data.device_code !== "string" ||
      !data.device_code ||
      typeof data.user_code !== "string" ||
      !/^[A-Z0-9-]{4,32}$/.test(data.user_code) ||
      !Number.isInteger(data.expires_in) ||
      data.expires_in < 1 ||
      data.expires_in > 600 ||
      !Number.isInteger(interval) ||
      interval < 1 ||
      interval > 60
    )
      throw new Error("Scope device sign-in unavailable");
    const url = verificationUrl(data.verification_uri, config.authkitDomain);
    const complete = data.verification_uri_complete
      ? verificationUrl(data.verification_uri_complete, config.authkitDomain)
      : url;
    const deadline = AbortSignal.timeout(data.expires_in * 1000);
    const polling = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
    output(
      `Sign in to Scope at ${url}\nCode: ${data.user_code}\nOr open: ${complete}`,
    );
    try {
      while (true) {
        await delay(interval * 1000, undefined, { signal: polling });
        const result = await post(
          "authenticate",
          {
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: data.device_code,
            client_id: config.clientId,
          },
          polling,
        );
        if (result.response.ok) {
          await storeTokens(config, result.data);
          output("Scope CLI signed in; session saved privately.");
          return;
        }
        if (result.data.error === "authorization_pending") continue;
        if (result.data.error === "slow_down") {
          interval += 5;
          continue;
        }
        if (result.data.error === "access_denied")
          throw new Error("Sign-in denied");
        if (result.data.error === "expired_token")
          throw new Error("Sign-in expired");
        throw new Error("Scope device sign-in failed");
      }
    } catch (error) {
      if (signal?.aborted) throw new Error("Sign-in cancelled");
      if (deadline.aborted) throw new Error("Sign-in expired");
      throw error;
    }
  });
}
export async function logout() {
  return withConfigLock(async () => {
    const config = await loadConfig();
    delete config.tokens;
    await saveConfig(config);
  });
}
