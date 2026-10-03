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
import type * as connect_access from "../connect/access.js";
import type * as connect_bridge from "../connect/bridge.js";
import type * as connect_connections from "../connect/connections.js";
import type * as connect_contracts from "../connect/contracts.js";
import type * as connect_tickets from "../connect/tickets.js";
import type * as domain_apps from "../domain/apps.js";
import type * as domain_returnPaths from "../domain/returnPaths.js";
import type * as functions from "../functions.js";
import type * as http from "../http.js";
import type * as http_oauth from "../http/oauth.js";
import type * as lib_json from "../lib/json.js";
import type * as lib_responses from "../lib/responses.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as probe from "../probe.js";
import type * as probeNotifications from "../probeNotifications.js";
import type * as probeSchema from "../probeSchema.js";
import type * as tables_connections_actions from "../tables/connections/actions.js";
import type * as tables_connections_helpers from "../tables/connections/helpers.js";
import type * as tables_connections_mutations from "../tables/connections/mutations.js";
import type * as tables_connections_queries from "../tables/connections/queries.js";
import type * as tables_oauthStates_finish from "../tables/oauthStates/finish.js";
import type * as tables_oauthStates_mutations from "../tables/oauthStates/mutations.js";
import type * as tables_oauthStates_queries from "../tables/oauthStates/queries.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "connect/access": typeof connect_access;
  "connect/bridge": typeof connect_bridge;
  "connect/connections": typeof connect_connections;
  "connect/contracts": typeof connect_contracts;
  "connect/tickets": typeof connect_tickets;
  "domain/apps": typeof domain_apps;
  "domain/returnPaths": typeof domain_returnPaths;
  functions: typeof functions;
  http: typeof http;
  "http/oauth": typeof http_oauth;
  "lib/json": typeof lib_json;
  "lib/responses": typeof lib_responses;
  "lib/secrets": typeof lib_secrets;
  probe: typeof probe;
  probeNotifications: typeof probeNotifications;
  probeSchema: typeof probeSchema;
  "tables/connections/actions": typeof tables_connections_actions;
  "tables/connections/helpers": typeof tables_connections_helpers;
  "tables/connections/mutations": typeof tables_connections_mutations;
  "tables/connections/queries": typeof tables_connections_queries;
  "tables/oauthStates/finish": typeof tables_oauthStates_finish;
  "tables/oauthStates/mutations": typeof tables_oauthStates_mutations;
  "tables/oauthStates/queries": typeof tables_oauthStates_queries;
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

export declare const components: {
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
