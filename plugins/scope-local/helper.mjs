import { setTimeout as delay } from "node:timers/promises";
import { accessToken } from "./oauth.mjs";
const reads = {
  "airtable-rest-read": {
    profileId: "bases.read",
    intent: "List the available Airtable bases",
    url: "https://api.airtable.com/v0/meta/bases",
    field: "bases",
    select: (b) => ({
      id: b.id,
      name: b.name,
      permissionLevel: b.permissionLevel,
    }),
  },
  "slack-read": {
    profileId: "channels.read",
    intent: "List public Slack channels",
    url: "https://slack.com/api/conversations.list?types=public_channel&limit=100",
    field: "channels",
    select: (c) => ({ id: c.id, name: c.name, isArchived: c.is_archived }),
  },
};
export async function scopeCall(
  operation,
  body,
  { session = accessToken, fetcher = fetch, signal } = {},
) {
  const config = await session();
  const response = await fetcher(config.origin + "/api/agent/" + operation, {
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
export async function readProvider(
  integrationId,
  args,
  { session, fetcher = fetch, wait = delay, signal } = {},
) {
  const read = reads[integrationId],
    options = { session, fetcher, signal };
  if (
    !read ||
    !args ||
    typeof args.accountId !== "string" ||
    !args.accountId ||
    (args.requestId
      ? !/^[\w-]{1,128}$/.test(args.requestId)
      : !/^[\w-]{16,128}$/.test(args.key ?? "")) ||
    typeof args.reason !== "string" ||
    !args.reason.trim() ||
    args.reason.length > 1000
  )
    throw new Error("Invalid request");
  const seconds = args.waitSeconds ?? 90;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 240)
    throw new Error("Invalid wait");
  const request = args.requestId
    ? { id: args.requestId }
    : await scopeCall(
        "request",
        {
          accountId: args.accountId,
          key: args.key,
          reason: args.reason,
          intent: read.intent,
        },
        options,
      );
  let context = await scopeCall("status", { id: request.id }, options);
  if (
    context.accountId !== args.accountId ||
    context.integrationId !== integrationId ||
    context.profileId !== read.profileId ||
    context.profileVersion !== 1 ||
    context.intent !== read.intent
  )
    throw new Error("Request does not match this operation");
  const until = Date.now() + seconds * 1000;
  while (
    context.status === "pending" &&
    Date.now() < until &&
    !signal?.aborted
  ) {
    await wait(Math.min(1000, until - Date.now()), undefined, { signal });
    context = await scopeCall("status", { id: request.id }, options);
  }
  if (context.status !== "approved" || signal?.aborted)
    return {
      status: context.status,
      requestId: request.id,
      ...(request.approvalUrl ? { approvalUrl: request.approvalUrl } : {}),
      ...(args.key ? { retryKey: args.key } : {}),
    };
  // Only safe reads are supported. At most one re-acquisition after provider 401,
  // under the same frozen approval; no automatic replay of ambiguous writes.
  for (let attempt = 0; attempt < 2; attempt++) {
    const grant = await scopeCall("deliver", { id: request.id }, options);
    if (grant.status !== "ready")
      return { status: grant.status, requestId: request.id };
    if (
      [
        "accountId",
        "integrationId",
        "grantVersion",
        "profileId",
        "profileVersion",
        "requesterConnectionId",
        "collectorConnectionId",
        "intent",
      ].some((key) => grant[key] !== context[key]) ||
      grant.requestId !== request.id ||
      grant.approvalExpiresAt !== context.approvalExpiresAt ||
      grant.approvalExpiresAt <= Date.now() ||
      !Number.isFinite(grant.providerExpiresAt) ||
      grant.providerExpiresAt <= Date.now() + 1000 ||
      typeof grant.accessToken !== "string" ||
      !grant.accessToken ||
      typeof grant.receiptProof !== "string" ||
      !grant.receiptProof
    )
      throw new Error("Invalid credential context");
    let token = grant.accessToken;
    delete grant.accessToken;
    try {
      // Receipt acknowledges this process received access, not completed work.
      await scopeCall(
        "receipt",
        { id: request.id, receiptProof: grant.receiptProof },
        options,
      );
      const response = await fetcher(read.url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      });
      if (response.status === 401 && attempt === 0) continue;
      if (!response.ok) throw new Error("Provider read unavailable");
      const data = await response.json();
      if (
        (integrationId === "slack-read" && data.ok !== true) ||
        !Array.isArray(data[read.field])
      )
        throw new Error("Invalid provider response");
      const output = {
        requestId: request.id,
        accountId: args.accountId,
        [read.field]: data[read.field].slice(0, 100).map(read.select),
        hasMore: !!(data.offset || data.response_metadata?.next_cursor),
      };
      const serialized = JSON.stringify(output);
      if (
        serialized.length > 128_000 ||
        [
          token,
          encodeURIComponent(token),
          Buffer.from(token).toString("base64"),
        ].some((value) => serialized.includes(value))
      )
        throw new Error("Sensitive provider response rejected");
      return output;
    } finally {
      token = "";
    }
  }
  throw new Error("Provider authorization unavailable");
}
export const listBases = (args, options) =>
  readProvider("airtable-rest-read", args, options);
export const listChannels = (args, options) =>
  readProvider("slack-read", args, options);
