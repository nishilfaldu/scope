/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentErrors from "../agentErrors.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as httpAgent from "../httpAgent.js";
import type * as httpContracts from "../httpContracts.js";
import type * as httpCors from "../httpCors.js";
import type * as httpOauth from "../httpOauth.js";
import type * as json from "../json.js";
import type * as oauth from "../oauth.js";
import type * as permissions from "../permissions.js";
import type * as providerAccess from "../providerAccess.js";
import type * as secrets from "../secrets.js";
import type * as tables_connections_actions from "../tables/connections/actions.js";
import type * as tables_connections_mutations from "../tables/connections/mutations.js";
import type * as tables_connections_queries from "../tables/connections/queries.js";
import type * as tables_oauthStates_mutations from "../tables/oauthStates/mutations.js";
import type * as tables_passports_credentials from "../tables/passports/credentials.js";
import type * as tables_passports_mutations from "../tables/passports/mutations.js";
import type * as tables_passports_queries from "../tables/passports/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentErrors: typeof agentErrors;
  crons: typeof crons;
  http: typeof http;
  httpAgent: typeof httpAgent;
  httpContracts: typeof httpContracts;
  httpCors: typeof httpCors;
  httpOauth: typeof httpOauth;
  json: typeof json;
  oauth: typeof oauth;
  permissions: typeof permissions;
  providerAccess: typeof providerAccess;
  secrets: typeof secrets;
  "tables/connections/actions": typeof tables_connections_actions;
  "tables/connections/mutations": typeof tables_connections_mutations;
  "tables/connections/queries": typeof tables_connections_queries;
  "tables/oauthStates/mutations": typeof tables_oauthStates_mutations;
  "tables/passports/credentials": typeof tables_passports_credentials;
  "tables/passports/mutations": typeof tables_passports_mutations;
  "tables/passports/queries": typeof tables_passports_queries;
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
