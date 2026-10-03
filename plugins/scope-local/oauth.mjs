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
import lockfile from "proper-lockfile";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
export const configPath =
  process.env.SCOPE_CONFIG ??
  join(homedir(), ".config", "scope", "config.json");
export const redirectUrl = "http://127.0.0.1:47831/callback";
export const oauthScope = "openid profile email offline_access";
function origin(value, local = false) {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(
        local &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )) ||
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
  config.issuer = origin(config.issuer);
  if (
    typeof config.clientId !== "string" ||
    !config.clientId ||
    config.clientSecret
  )
    throw new Error("Configure a registered public OAuth client.");
  const resource = config.origin + "/api/mcp";
  if (
    config.tokens &&
    (!Number.isFinite(config.expiresAt) ||
      typeof config.tokens.access_token !== "string" ||
      !config.tokens.access_token ||
      typeof config.tokens.refresh_token !== "string" ||
      !config.tokens.refresh_token ||
      config.tokens.issuer !== config.issuer ||
      config.tokenResource !== resource ||
      config.tokenClientId !== config.clientId)
  )
    throw new Error(
      "OAuth session belongs to another client, issuer or resource. Sign in again.",
    );
  return config;
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
// Serialize login/refresh across helper processes so rotating refresh tokens cannot race.
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
export function oauthProvider(config, redirectToAuthorization) {
  let verifier, state;
  const resource = config.origin + "/api/mcp";
  return {
    redirectUrl,
    clientMetadata: {
      redirect_uris: [redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Scope local helper",
      scope: oauthScope,
    },
    clientInformation: () => ({
      client_id: config.clientId,
      issuer: config.issuer,
    }),
    tokens: () => config.tokens,
    async saveTokens(tokens) {
      if (
        tokens.issuer !== config.issuer ||
        !tokens.access_token ||
        !tokens.refresh_token ||
        !Number.isFinite(tokens.expires_in) ||
        tokens.expires_in <= 0 ||
        tokens.token_type.toLowerCase() !== "bearer"
      )
        throw new Error("Invalid OAuth session");
      config.tokens = tokens;
      config.expiresAt = Date.now() + tokens.expires_in * 1000;
      config.tokenResource = resource;
      config.tokenClientId = config.clientId;
      await saveConfig(config);
    },
    state: () => (state ??= randomBytes(32).toString("hex")),
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => {
      if (!verifier) throw new Error("Authorization session lost");
      return verifier;
    },
    async validateResourceURL(serverUrl, advertised) {
      if (String(serverUrl) !== resource || advertised !== resource)
        throw new Error("Unexpected OAuth resource");
      return new URL(resource);
    },
    redirectToAuthorization,
  };
}
export function oauthFetch(config) {
  return (url, options = {}) => {
    const parsed = new URL(url);
    if (
      ![config.origin, config.issuer].includes(parsed.origin) ||
      parsed.username ||
      parsed.password
    )
      throw new Error("OAuth destination rejected");
    return fetch(parsed, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  };
}
export async function accessToken() {
  return withConfigLock(async () => {
    const config = await loadConfig();
    if (!config.tokens) throw new Error("Run Scope helper sign-in first.");
    if (config.expiresAt <= Date.now() + 30_000) {
      const provider = oauthProvider(config, () => {
        throw new Error("Run Scope helper sign-in again.");
      });
      await auth(provider, {
        serverUrl: config.origin + "/api/mcp",
        scope: oauthScope,
        fetchFn: oauthFetch(config),
      });
    }
    if (config.expiresAt <= Date.now() + 1000)
      throw new Error("Scope sign-in expired.");
    return { origin: config.origin, accessToken: config.tokens.access_token };
  });
}
