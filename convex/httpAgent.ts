import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  UNAUTHORIZED_ERROR,
  PLATFORM_UNAVAILABLE_ERROR,
  type AgentErrorCode,
} from "./agentErrors";
import { corsNoContent, jsonResponse } from "./httpCors";
import { credentialsContract, type PostContract } from "./httpContracts";
import { isPlainObject } from "./json";
import { issueShortLivedAccess } from "./providerAccess";

function errorResponse(
  status: number,
  error: string,
  code: AgentErrorCode,
): Response {
  return jsonResponse(status, { error, code });
}

async function readObjectBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body", "invalid_request");
  }
  if (!isPlainObject(raw)) {
    return errorResponse(400, "Body must be a JSON object", "invalid_request");
  }
  return raw;
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
): string | Response {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    return errorResponse(400, `${key} must be a string`, "invalid_request");
  }
  return value;
}

function requiredHeader(request: Request, key: string): string | Response {
  const value = request.headers.get(key);
  if (typeof value !== "string" || value.length === 0) {
    return errorResponse(400, `${key} must be a string`, "invalid_request");
  }
  return value;
}

export const optionsOk = httpAction(async () => corsNoContent());

function describePost(contract: PostContract) {
  return httpAction(async () => jsonResponse(200, contract));
}

export const describeCredentials = describePost(credentialsContract);

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
    return errorResponse(decision.status, decision.reason, decision.code);
  }

  const issued = await issueShortLivedAccess(ctx, decision.provider);
  if ("error" in issued) {
    await ctx.runMutation(internal.tokens.logMintDenied, {
      passportId: decision.passportId,
      platform: decision.platform,
      reason: issued.error,
    });
    const status = issued.error.endsWith("is not connected") ? 403 : 503;
    const code =
      status === 403 ? "platform_unavailable" : "provider_error";
    const error =
      status === 403 ? PLATFORM_UNAVAILABLE_ERROR : issued.error;
    return errorResponse(status, error, code);
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

export const handlePlatforms = httpAction(async (ctx, request) => {
  const passportId = requiredHeader(request, "passportId");
  if (passportId instanceof Response) {
    return passportId;
  }
  const invokeKey = requiredHeader(request, "invokeKey");
  if (invokeKey instanceof Response) {
    return invokeKey;
  }

  const decision = await ctx.runQuery(internal.passports.discoverPlatforms, {
    token: passportId,
    invokeKey,
    now: Date.now(),
  });
  if (!decision.ok) {
    return errorResponse(decision.status, decision.reason, decision.code);
  }
  return jsonResponse(200, {
    expiresAt: decision.expiresAt,
    platforms: decision.platforms,
  });
});
