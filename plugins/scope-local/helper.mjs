import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const configPath =
  process.env.SCOPE_PROBE_CONFIG ??
  join(homedir(), ".config", "scope-probe", "config.json");
export async function loadConfig() {
  const info = await stat(configPath);
  if ((info.mode & 0o077) !== 0)
    throw new Error("Scope config must be private (0600).");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const url = new URL(config.origin);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("Invalid Scope origin");
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Invalid Scope origin");
  return { ...config, origin: url.origin };
}
export async function listBases(
  args,
  { config, fetcher = fetch, wait = delay, signal } = {},
) {
  if (
    !args ||
    typeof args.accountId !== "string" ||
    typeof args.reason !== "string" ||
    !args.reason.trim() ||
    args.reason.length > 1000 ||
    !/^[\w-]{16,128}$/.test(args.key ?? "")
  )
    throw new Error("Invalid request");
  const seconds = args.waitSeconds ?? 90;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 240)
    throw new Error("Invalid wait");
  config ??= await loadConfig();
  if (
    typeof config.accessToken !== "string" ||
    !config.accessToken ||
    config.agentConnectionId ||
    config.agentConnectionSecret
  )
    throw new Error(
      "Sign in to Scope through WorkOS MCP before requesting access",
    );
  async function scope(operation, body) {
    const response = await fetcher(config.origin + "/api/probe/" + operation, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error("Scope authentication or approval unavailable");
    return response.json();
  }
  const request = await scope("request", {
    accountId: args.accountId,
    key: args.key,
    reason: args.reason,
    intent: "List the available Airtable bases",
  });
  const until = Date.now() + seconds * 1000;
  do {
    const grant = await scope("deliver", { id: request.id });
    if (grant.status === "ready") {
      const sharedPat = grant.credentialKind === "shared-pat";
      if (
        sharedPat &&
        (typeof grant.baseId !== "string" ||
          !/^app[A-Za-z0-9]+$/.test(grant.baseId) ||
          grant.providerExpiresAt !== null ||
          !Number.isFinite(grant.approvalExpiresAt) ||
          grant.approvalExpiresAt <= Date.now())
      )
        throw new Error("Invalid PAT test scope");
      if (
        grant.accountId !== args.accountId ||
        typeof grant.accessToken !== "string" ||
        !grant.accessToken ||
        !Number.isFinite(grant.expiresAt) ||
        grant.expiresAt <= Date.now() + 1000 ||
        typeof grant.providerUserId !== "string"
      )
        throw new Error("Invalid credential");
      let token = grant.accessToken;
      delete grant.accessToken;
      try {
        // Receipt means this process has validated and received the credential;
        // it does not claim durable local storage or completed provider work.
        if (grant.receiptId)
          await scope("ack", { id: request.id, receiptId: grant.receiptId });
        const headers = { Authorization: `Bearer ${token}` };
        const options = {
          headers,
          redirect: "error",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
        };
        const identityResponse = await fetcher(
          "https://api.airtable.com/v0/meta/whoami",
          options,
        );
        if (!identityResponse.ok)
          throw new Error("Airtable identity check failed");
        const identity = await identityResponse.json();
        if (identity.id !== grant.providerUserId)
          throw new Error("Airtable account mismatch");
        const response = await fetcher(
          "https://api.airtable.com/v0/meta/bases",
          options,
        );
        if (!response.ok) throw new Error("Airtable request failed");
        const data = await response.json();
        if (!Array.isArray(data.bases))
          throw new Error("Invalid Airtable response");
        if (
          sharedPat &&
          (data.bases.length !== 1 ||
            data.bases[0].id !== grant.baseId ||
            data.offset)
        )
          throw new Error("Unexpected PAT base scope");
        const output = {
          accountId: args.accountId,
          providerUserId: identity.id,
          expiresAt: grant.expiresAt,
          ...(sharedPat
            ? {
                credentialKind: "shared-pat",
                expiryMeaning: "Connect response expiry; PAT expiry unverified",
                providerExpiresAt: null,
                approvalExpiresAt: grant.approvalExpiresAt,
              }
            : {}),
          bases: data.bases.slice(0, 100).map((b) => ({
            id: b.id,
            name: b.name,
            permissionLevel: b.permissionLevel,
          })),
          hasMore: typeof data.offset === "string",
        };
        const serialized = JSON.stringify(output);
        if (
          [
            token,
            encodeURIComponent(token),
            Buffer.from(token).toString("base64"),
          ].some((s) => serialized.includes(s))
        )
          throw new Error("Sensitive provider response rejected");
        if (serialized.length > 128_000)
          throw new Error("Provider response too large");
        return output;
      } finally {
        token = "";
      }
    }
    if (!["pending", "acquiring"].includes(grant.status))
      return { status: grant.status, requestId: request.id };
    if (Date.now() >= until) break;
    await wait(Math.min(1000, until - Date.now()), undefined, { signal });
  } while (!signal?.aborted);
  return {
    status: "pending",
    requestId: request.id,
    approvalUrl: request.approvalUrl,
    retryKey: args.key,
  };
}
