import { ALL_APPS, PROVIDERS } from "../domain/apps";
import { AGENT_ERROR_CODES, type AgentErrorCode } from "../lib/errors";

type JsonValue = {
  type: "string" | "number" | "boolean" | "object" | "array";
  const?: string;
  enum?: readonly string[];
  items?: JsonValue;
  properties?: Record<string, JsonValue>;
};

type JsonSchema = {
  type: "object";
  required?: readonly string[];
  properties: Record<string, JsonValue>;
};

export type PostContract = {
  method: "POST";
  body: JsonSchema;
  success: JsonSchema;
};

export const credentialsContract: PostContract = {
  method: "POST",
  body: {
    type: "object",
    required: ["passportToken", "passportSecret", "app"],
    properties: {
      passportToken: { type: "string" },
      passportSecret: { type: "string" },
      app: { type: "string", enum: ALL_APPS },
      refresh: { type: "boolean" },
    },
  },
  success: {
    type: "object",
    required: [
      "accessToken",
      "tokenType",
      "app",
      "expiresAt",
      "expiresIn",
    ],
    properties: {
      accessToken: { type: "string" },
      tokenType: { type: "string", const: "Bearer" },
      app: { type: "string", enum: ALL_APPS },
      expiresAt: { type: "number" },
      expiresIn: { type: "number" },
    },
  },
};

type RouteAuth =
  | { type: "none" }
  | { type: "headers"; headers: readonly string[] }
  | { type: "body"; fields: readonly string[] };

export type RouteSpec = {
  path: string;
  method: "GET" | "POST";
  summary: string;
  auth: RouteAuth;
  body?: JsonSchema;
  success?: JsonSchema;
};

export const errorCatalog: Record<
  AgentErrorCode,
  { meaning: string; hint: string }
> = {
  UNAUTHORIZED: {
    meaning: "The passportToken or passportSecret is wrong.",
    hint: "Check the pair for typos, or issue a new passport in the dashboard.",
  },
  REVOKED: {
    meaning: "This passport was revoked.",
    hint: "Issue a new passport. A revoked passport cannot be restored.",
  },
  EXPIRED: {
    meaning: "This passport has expired.",
    hint: "Issue a new passport with a later expiry.",
  },
  APP_UNAVAILABLE: {
    meaning: "This app is not attached to this passport.",
    hint: "Attach the app to this passport in the dashboard first.",
  },
  INVALID_REQUEST: {
    meaning: "The request is malformed.",
    hint: "Match the contract for this route exactly, including field types.",
  },
  PROVIDER_ERROR: {
    meaning: "The connected app's provider failed.",
    hint: "Retry. If it keeps failing, reconnect the app in the dashboard.",
  },
};

const appsSuccess: JsonSchema = {
  type: "object",
  required: ["expiresAt", "apps"],
  properties: {
    expiresAt: { type: "number" },
    apps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          app: { type: "string", enum: ALL_APPS },
          status: { type: "string", enum: ["on", "off"] },
        },
      },
    },
  },
};

const healthSuccess: JsonSchema = {
  type: "object",
  required: ["ok", "oauth"],
  properties: {
    ok: { type: "boolean" },
    oauth: { type: "boolean" },
  },
};

const oauthRoutes: RouteSpec[] = PROVIDERS.flatMap((provider) => [
  {
    path: `/api/${provider}/connect`,
    method: "GET" as const,
    summary: `Start the ${provider} connect flow. Browser flow: redirects to the provider's consent screen.`,
    auth: { type: "none" as const },
  },
  {
    path: `/api/${provider}/callback`,
    method: "GET" as const,
    summary: `OAuth callback for ${provider}. The provider redirects here after consent; not called directly.`,
    auth: { type: "none" as const },
  },
]);

export const routes: RouteSpec[] = [
  {
    path: "/",
    method: "GET",
    summary: "This spec. Start here.",
    auth: { type: "none" },
  },
  {
    path: "/api/health",
    method: "GET",
    summary: "Liveness check.",
    auth: { type: "none" },
    success: healthSuccess,
  },
  {
    path: "/api/credentials",
    method: "POST",
    summary: "Exchange a passport for a short-lived access token for one app.",
    auth: { type: "body", fields: ["passportToken", "passportSecret"] },
    body: credentialsContract.body,
    success: credentialsContract.success,
  },
  {
    path: "/api/apps",
    method: "GET",
    summary: "List the apps on this passport and whether each is on or off.",
    auth: { type: "headers", headers: ["passportToken", "passportSecret"] },
    success: appsSuccess,
  },
  ...oauthRoutes,
];

export const discoverySpec = {
  name: "Agent Passport API",
  summary:
    "Scoped, revocable identity for agents. This document is the whole contract: every route, its auth, its body, its success shape, and what each error code means.",
  errorShape: {
    type: "object",
    required: ["error", "code"],
    properties: {
      error: { type: "string" },
      code: { type: "string", enum: AGENT_ERROR_CODES },
    },
  },
  errors: errorCatalog,
  routes,
};
