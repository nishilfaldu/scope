import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  APP_UNAVAILABLE_ERROR,
  type AgentErrorCode,
} from "./agentErrors";
import { corsNoContent, jsonResponse } from "./httpCors";
import { credentialsContract, type PostContract } from "./httpContracts";
import { isPlainObject } from "./json";
import { oauthConfigured } from "./oauth";
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
    return errorResponse(400, "Invalid JSON body", "INVALID_REQUEST");
  }
  if (!isPlainObject(raw)) {
    return errorResponse(400, "Body must be a JSON object", "INVALID_REQUEST");
  }
  return raw;
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
): string | Response {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    return errorResponse(400, `${key} must be a string`, "INVALID_REQUEST");
  }
  return value;
}

function requiredHeader(request: Request, key: string): string | Response {
  const value = request.headers.get(key);
  if (typeof value !== "string" || value.length === 0) {
    return errorResponse(400, `${key} must be a string`, "INVALID_REQUEST");
  }
  return value;
}

export const optionsOk = httpAction(async () => corsNoContent());

function describePost(contract: PostContract) {
  return httpAction(async () => jsonResponse(200, contract));
}

export const describeCredentials = describePost(credentialsContract);

export const handleHealth = httpAction(async () => {
  return jsonResponse(200, { ok: true, oauth: oauthConfigured() });
});

export const handleCredentials = httpAction(async (ctx, request) => {
  const body = await readObjectBody(request);
  if (body instanceof Response) {
    return body;
  }

  const passportToken = requiredString(body, "passportToken");
  if (passportToken instanceof Response) {
    return passportToken;
  }
  const passportSecret = requiredString(body, "passportSecret");
  if (passportSecret instanceof Response) {
    return passportSecret;
  }
  const app = requiredString(body, "app");
  if (app instanceof Response) {
    return app;
  }
  if (body.refresh !== undefined && typeof body.refresh !== "boolean") {
    return errorResponse(400, "refresh must be a boolean", "INVALID_REQUEST");
  }
  const refresh = body.refresh === true;

  const decision = await ctx.runMutation(internal.tables.passports.credentials.authorizeCreate, {
    passportToken,
    passportSecret,
    app,
    refresh,
  });
  if (!decision.ok) {
    return errorResponse(decision.status, decision.reason, decision.code);
  }

  const issued = await issueShortLivedAccess(ctx, decision.provider);
  if ("error" in issued) {
    const status = issued.error.endsWith("is not connected") ? 403 : 503;
    const code =
      status === 403 ? "APP_UNAVAILABLE" : "PROVIDER_ERROR";
    const error =
      status === 403 ? APP_UNAVAILABLE_ERROR : issued.error;
    return errorResponse(status, error, code);
  }

  const committed = await ctx.runMutation(internal.tables.passports.credentials.commitCreate, {
    passportId: decision.passportId,
    app: decision.app,
    expiresAt: issued.expiresAt,
    refresh,
  });
  return jsonResponse(200, {
    accessToken: issued.accessToken,
    tokenType: "Bearer",
    app: decision.app,
    expiresAt: committed.expiresAt,
    expiresIn: Math.max(
      0,
      Math.floor((committed.expiresAt - Date.now()) / 1000),
    ),
  });
});

export const handleApps = httpAction(async (ctx, request) => {
  const passportToken = requiredHeader(request, "passportToken");
  if (passportToken instanceof Response) {
    return passportToken;
  }
  const passportSecret = requiredHeader(request, "passportSecret");
  if (passportSecret instanceof Response) {
    return passportSecret;
  }

  const decision = await ctx.runQuery(internal.tables.passports.queries.discoverApps, {
    passportToken,
    passportSecret,
    now: Date.now(),
  });
  if (!decision.ok) {
    return errorResponse(decision.status, decision.reason, decision.code);
  }
  return jsonResponse(200, {
    expiresAt: decision.expiresAt,
    apps: decision.apps,
  });
});
