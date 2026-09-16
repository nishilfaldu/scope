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
    required: ["sliceToken", "sliceSecret", "app"],
    properties: {
      sliceToken: { type: "string" },
      sliceSecret: { type: "string" },
      app: { type: "string", enum: ALL_APPS },
      refresh: { type: "boolean" },
    },
  },
  success: {
    type: "object",
    required: ["accessToken", "tokenType", "app", "expiresAt", "expiresIn"],
    properties: {
      accessToken: { type: "string" },
      tokenType: { type: "string", const: "Bearer" },
      app: { type: "string", enum: ALL_APPS },
      expiresAt: { type: "number" },
      expiresIn: { type: "number" },
    },
  },
};

export const claimContract: PostContract = {
  method: "POST",
  body: {
    type: "object",
    required: ["sliceToken", "sliceSecret", "requestId"],
    properties: {
      sliceToken: { type: "string" },
      sliceSecret: { type: "string" },
      requestId: { type: "string" },
    },
  },
  success: credentialsContract.success,
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
    meaning: "The sliceToken or sliceSecret is wrong.",
    hint: "Check the pair for typos, or create a new slice in the dashboard.",
  },
  REVOKED: {
    meaning: "This slice was revoked.",
    hint: "Create a new slice. A revoked slice cannot be restored.",
  },
  EXPIRED: {
    meaning: "This slice has expired.",
    hint: "Create a new slice with a later expiry.",
  },
  APP_UNAVAILABLE: {
    meaning: "This app is not available to this slice.",
    hint: "Turn on the app in this slice's grant in the dashboard first.",
  },
  INVALID_REQUEST: {
    meaning: "The request is malformed.",
    hint: "Match the contract for this route exactly, including field types.",
  },
  PROVIDER_ERROR: {
    meaning: "The connected app's provider failed.",
    hint: "Retry. If it keeps failing, reconnect the app in the dashboard.",
  },
  SHORT_LIVED_UNAVAILABLE: {
    meaning:
      "The provider cannot mint a short-lived access token without handing off the vault standing upstream token.",
    hint: "Reconnect the provider with a refresh-capable OAuth grant (offline / token rotation). Standing-only user tokens are never returned to agents.",
  },
  APPROVAL_REQUIRED: {
    meaning:
      "This slice requires operator approval before a short-lived token is minted.",
    hint: "Poll POST /api/credentials/claim with the requestId until the operator Approves on the board, then claim once within the claim window.",
  },
  APPROVAL_DENIED: {
    meaning: "The operator denied this credential request.",
    hint: "Ask the operator, or create a new request with POST /api/credentials.",
  },
  APPROVAL_EXPIRED: {
    meaning: "The approval request or claim window expired.",
    hint: "Create a new request with POST /api/credentials.",
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
          allowed: { type: "boolean" },
          connected: { type: "boolean" },
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
    summary:
      "Exchange slice credentials for a short-lived access token for one app. With mintPolicy=approve, returns 202 + requestId instead of minting immediately. Never returns vault standing or refresh tokens.",
    auth: { type: "body", fields: ["sliceToken", "sliceSecret"] },
    body: credentialsContract.body,
    success: credentialsContract.success,
  },
  {
    path: "/api/credentials/claim",
    method: "POST",
    summary:
      "Poll or claim an approval-gated credential request. Pending returns 202; after Approve, a single claim mints a provider-native short-lived token (never the vault standing token).",
    auth: { type: "body", fields: ["sliceToken", "sliceSecret", "requestId"] },
    body: claimContract.body,
    success: claimContract.success,
  },
  {
    path: "/api/apps",
    method: "GET",
    summary: "List each app's grant permission and provider connection state.",
    auth: { type: "headers", headers: ["x-slice-token", "x-slice-secret"] },
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
