import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { corsNoContent, jsonResponse } from "./httpCors";
import { lookupAction, runAction, type InvokeResult } from "./invoke";
import { isPlainObject } from "./json";
import { issueShortLivedAccess, standingAccessToken } from "./providerAccess";

const ARGS_PREVIEW_MAX = 400;

function previewArgs(args: Record<string, unknown>): string {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    redacted[key] = /token|secret|key|authorization/i.test(key)
      ? "[redacted]"
      : value;
  }
  const raw = JSON.stringify(redacted);
  if (raw.length <= ARGS_PREVIEW_MAX) {
    return raw;
  }
  return `${raw.slice(0, ARGS_PREVIEW_MAX)}…`;
}

async function readObjectBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  if (!isPlainObject(raw)) {
    return jsonResponse(400, { error: "Body must be a JSON object" });
  }
  return raw;
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
): string | Response {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    return jsonResponse(400, { error: `${key} must be a string` });
  }
  return value;
}

export const optionsOk = httpAction(async () => corsNoContent());

export const handleInvoke = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) {
    return body;
  }

  const passportId = requiredString(body, "passportId");
  if (passportId instanceof Response) {
    return passportId;
  }
  const invokeKey = requiredString(body, "invokeKey");
  if (invokeKey instanceof Response) {
    return invokeKey;
  }
  const action = requiredString(body, "action");
  if (action instanceof Response) {
    return action;
  }

  let args: Record<string, unknown> = {};
  if (body.args !== undefined) {
    if (!isPlainObject(body.args)) {
      return jsonResponse(400, { error: "args must be an object" });
    }
    args = body.args;
  }

  const passport = await ctx.runQuery(internal.passports.getByCredentials, {
    token: passportId,
    invokeKey,
  });
  if (!passport) {
    return jsonResponse(401, { error: "Unknown passport or invoke key" });
  }

  const preview = previewArgs(args);
  const decision = await ctx.runMutation(internal.audit.recordPresentation, {
    passportId: passport._id,
    action,
    argsPreview: preview,
  });
  if (!decision.allowRun) {
    return jsonResponse(decision.status, { error: decision.reason });
  }

  const spec = lookupAction(action);
  if (!spec) {
    return jsonResponse(400, { error: `Unknown action: ${action}` });
  }

  const githubToken = await standingAccessToken(ctx, "github");
  const result: InvokeResult = await runAction(spec, args, {
    passportName: passport.name,
    githubToken,
  });
  await ctx.runMutation(internal.audit.recordUse, {
    passportId: passport._id,
    action,
    argsPreview: preview,
    ok: result.ok,
    status: result.status,
    error: result.error,
  });
  return jsonResponse(result.status, result.body);
});

export const handleCredentials = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) {
    return body;
  }

  const passportId = requiredString(body, "passportId");
  if (passportId instanceof Response) {
    return passportId;
  }
  const invokeKey = requiredString(body, "invokeKey");
  if (invokeKey instanceof Response) {
    return invokeKey;
  }
  const platform = requiredString(body, "platform");
  if (platform instanceof Response) {
    return platform;
  }
  const refresh = body.refresh === true;

  const decision = await ctx.runMutation(internal.tokens.authorizeMint, {
    passportToken: passportId,
    invokeKey,
    platform,
    refresh,
  });
  if (!decision.ok) {
    return jsonResponse(decision.status, { error: decision.reason });
  }

  const issued = await issueShortLivedAccess(ctx, decision.provider);
  if ("error" in issued) {
    await ctx.runMutation(internal.tokens.logMintDenied, {
      passportId: decision.passportId,
      platform: decision.platform,
      reason: issued.error,
    });
    const status = issued.error.endsWith("is not connected") ? 403 : 503;
    return jsonResponse(status, { error: issued.error });
  }

  const committed = await ctx.runMutation(internal.tokens.commitMint, {
    passportId: decision.passportId,
    platform: decision.platform,
    accessToken: issued.accessToken,
    expiresAt: issued.expiresAt,
    refresh,
  });
  return jsonResponse(200, {
    accessToken: issued.accessToken,
    tokenType: "Bearer",
    platform: decision.platform,
    expiresAt: committed.expiresAt,
    expiresIn: Math.max(
      0,
      Math.floor((committed.expiresAt - Date.now()) / 1000),
    ),
  });
});
