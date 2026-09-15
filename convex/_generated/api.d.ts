/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as domain_apps from "../domain/apps.js";
import type * as http from "../http.js";
import type * as http_contracts from "../http/contracts.js";
import type * as http_helpers from "../http/helpers.js";
import type * as http_httpAppsHandler from "../http/httpAppsHandler.js";
import type * as http_httpCredentialsHandler from "../http/httpCredentialsHandler.js";
import type * as http_oauth from "../http/oauth.js";
import type * as lib_errors from "../lib/errors.js";
import type * as migrations from "../migrations.js";
import type * as lib_json from "../lib/json.js";
import type * as lib_requests from "../lib/requests.js";
import type * as lib_responses from "../lib/responses.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as oauth_access from "../oauth/access.js";
import type * as oauth_index from "../oauth/index.js";
import type * as oauth_providers_github from "../oauth/providers/github.js";
import type * as oauth_providers_google from "../oauth/providers/google.js";
import type * as oauth_providers_index from "../oauth/providers/index.js";
import type * as oauth_providers_slack from "../oauth/providers/slack.js";
import type * as oauth_shared from "../oauth/shared.js";
import type * as oauth_types from "../oauth/types.js";
import type * as tables_connections_actions from "../tables/connections/actions.js";
import type * as tables_connections_mutations from "../tables/connections/mutations.js";
import type * as tables_connections_queries from "../tables/connections/queries.js";
import type * as tables_oauthStates_mutations from "../tables/oauthStates/mutations.js";
import type * as tables_grants_helpers from "../tables/grants/helpers.js";
import type * as tables_passports_helpers from "../tables/passports/helpers.js";
import type * as tables_slices_credentials from "../tables/slices/credentials.js";
import type * as tables_slices_helpers from "../tables/slices/helpers.js";
import type * as tables_slices_mutations from "../tables/slices/mutations.js";
import type * as tables_slices_queries from "../tables/slices/queries.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  crons: typeof crons;
  "domain/apps": typeof domain_apps;
  http: typeof http;
  "http/contracts": typeof http_contracts;
  "http/helpers": typeof http_helpers;
  "http/httpAppsHandler": typeof http_httpAppsHandler;
  "http/httpCredentialsHandler": typeof http_httpCredentialsHandler;
  "http/oauth": typeof http_oauth;
  "lib/errors": typeof lib_errors;
  migrations: typeof migrations;
  "lib/json": typeof lib_json;
  "lib/requests": typeof lib_requests;
  "lib/responses": typeof lib_responses;
  "lib/secrets": typeof lib_secrets;
  "oauth/access": typeof oauth_access;
  "oauth/index": typeof oauth_index;
  "oauth/providers/github": typeof oauth_providers_github;
  "oauth/providers/google": typeof oauth_providers_google;
  "oauth/providers/index": typeof oauth_providers_index;
  "oauth/providers/slack": typeof oauth_providers_slack;
  "oauth/shared": typeof oauth_shared;
  "oauth/types": typeof oauth_types;
  "tables/connections/actions": typeof tables_connections_actions;
  "tables/connections/mutations": typeof tables_connections_mutations;
  "tables/connections/queries": typeof tables_connections_queries;
  "tables/oauthStates/mutations": typeof tables_oauthStates_mutations;
  "tables/grants/helpers": typeof tables_grants_helpers;
  "tables/passports/helpers": typeof tables_passports_helpers;
  "tables/slices/credentials": typeof tables_slices_credentials;
  "tables/slices/helpers": typeof tables_slices_helpers;
  "tables/slices/mutations": typeof tables_slices_mutations;
  "tables/slices/queries": typeof tables_slices_queries;
  users: typeof users;
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
