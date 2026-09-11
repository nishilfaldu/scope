/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audit from "../audit.js";
import type * as auditFields from "../auditFields.js";
import type * as connections from "../connections.js";
import type * as crons from "../crons.js";
import type * as github from "../github.js";
import type * as http from "../http.js";
import type * as httpAgent from "../httpAgent.js";
import type * as httpCors from "../httpCors.js";
import type * as httpOauth from "../httpOauth.js";
import type * as invoke from "../invoke.js";
import type * as json from "../json.js";
import type * as oauth from "../oauth.js";
import type * as passports from "../passports.js";
import type * as permissions from "../permissions.js";
import type * as providerAccess from "../providerAccess.js";
import type * as secrets from "../secrets.js";
import type * as tokens from "../tokens.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audit: typeof audit;
  auditFields: typeof auditFields;
  connections: typeof connections;
  crons: typeof crons;
  github: typeof github;
  http: typeof http;
  httpAgent: typeof httpAgent;
  httpCors: typeof httpCors;
  httpOauth: typeof httpOauth;
  invoke: typeof invoke;
  json: typeof json;
  oauth: typeof oauth;
  passports: typeof passports;
  permissions: typeof permissions;
  providerAccess: typeof providerAccess;
  secrets: typeof secrets;
  tokens: typeof tokens;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
