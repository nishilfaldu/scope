import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { lookupAction, runAction } from "./invoke";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const http = httpRouter();

http.route({
  path: "/api/invoke",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }),
});

http.route({
  path: "/api/invoke",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    if (!isPlainObject(raw)) {
      return jsonResponse(400, { error: "Body must be a JSON object" });
    }

    const { passportId, action, args: rawArgs } = raw;
    if (typeof passportId !== "string" || passportId.length === 0) {
      return jsonResponse(400, { error: "passportId must be a string" });
    }
    if (typeof action !== "string" || action.length === 0) {
      return jsonResponse(400, { error: "action must be a string" });
    }

    let args: Record<string, unknown> = {};
    if (rawArgs !== undefined) {
      if (!isPlainObject(rawArgs)) {
        return jsonResponse(400, { error: "args must be an object" });
      }
      args = rawArgs;
    }

    const passport = await ctx.runQuery(internal.passports.getByToken, {
      token: passportId,
    });
    if (!passport) {
      return jsonResponse(401, { error: "Unknown passport" });
    }
    if (passport.status === "revoked") {
      return jsonResponse(403, { error: "Passport revoked" });
    }
    if (passport.expiresAt <= Date.now()) {
      return jsonResponse(403, { error: "Passport expired" });
    }

    const spec = lookupAction(action);
    if (!spec) {
      return jsonResponse(400, { error: `Unknown action: ${action}` });
    }
    if (!passport.apps.includes(spec.app)) {
      return jsonResponse(403, { error: "Action not permitted" });
    }

    const result = await runAction(spec, args, {
      passportName: passport.name,
    });
    await ctx.runMutation(internal.passports.recordLastAction, {
      passportId,
      lastAction: action,
      lastActionOk: result.ok,
      lastError: result.error,
    });
    return jsonResponse(result.status, result.body);
  }),
});

export default http;
