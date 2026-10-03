import type * as auth from "../auth.js";
import type * as connect_access from "../connect/access.js";
import type * as connect_bridge from "../connect/bridge.js";
import type * as connect_connections from "../connect/connections.js";
import type * as connect_contracts from "../connect/contracts.js";
import type * as connect_tickets from "../connect/tickets.js";
import type * as devSeed from "../devSeed.js";
import type * as domain_apps from "../domain/apps.js";
import type * as domain_handoff from "../domain/handoff.js";
import type * as domain_requests from "../domain/requests.js";
import type * as domain_returnPaths from "../domain/returnPaths.js";
import type * as domain_slices from "../domain/slices.js";
import type * as functions from "../functions.js";
import type * as http from "../http.js";
import type * as http_contracts from "../http/contracts.js";
import type * as http_helpers from "../http/helpers.js";
import type * as http_httpAccessRequestHandlers from "../http/httpAccessRequestHandlers.js";
import type * as http_httpAccountsHandler from "../http/httpAccountsHandler.js";
import type * as http_httpAgentConnectionHandlers from "../http/httpAgentConnectionHandlers.js";
import type * as http_httpAgentSliceHandlers from "../http/httpAgentSliceHandlers.js";
import type * as http_httpAppsHandler from "../http/httpAppsHandler.js";
import type * as http_httpClaimHandler from "../http/httpClaimHandler.js";
import type * as http_httpCredentialsHandler from "../http/httpCredentialsHandler.js";
import type * as http_mint from "../http/mint.js";
import type * as http_oauth from "../http/oauth.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_json from "../lib/json.js";
import type * as lib_requests from "../lib/requests.js";
import type * as lib_responses from "../lib/responses.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_tokenEncryption from "../lib/tokenEncryption.js";
import type * as probe from "../probe.js";
import type * as probeSchema from "../probeSchema.js";
import type * as tables_agentConnectionExpiry from "../tables/agentConnectionExpiry.js";
import type * as tables_agentConnections from "../tables/agentConnections.js";
import type * as tables_agentDashboard from "../tables/agentDashboard.js";
import type * as tables_connections_actions from "../tables/connections/actions.js";
import type * as tables_connections_helpers from "../tables/connections/helpers.js";
import type * as tables_connections_mutations from "../tables/connections/mutations.js";
import type * as tables_connections_queries from "../tables/connections/queries.js";
import type * as tables_oauthStates_finish from "../tables/oauthStates/finish.js";
import type * as tables_oauthStates_mutations from "../tables/oauthStates/mutations.js";
import type * as tables_oauthStates_queries from "../tables/oauthStates/queries.js";
import type * as tables_slices_credentials from "../tables/slices/credentials.js";
import type * as tables_slices_helpers from "../tables/slices/helpers.js";
import type * as tables_slices_mutations from "../tables/slices/mutations.js";
import type * as tables_slices_queries from "../tables/slices/queries.js";
import type * as tables_slices_sliceRequestClaims from "../tables/slices/sliceRequestClaims.js";
import type * as tables_slices_sliceRequestExpiry from "../tables/slices/sliceRequestExpiry.js";
import type * as tables_slices_sliceRequests from "../tables/slices/sliceRequests.js";
import type * as tables_slices_tokenRequestClaims from "../tables/slices/tokenRequestClaims.js";
import type * as tables_slices_tokenRequests from "../tables/slices/tokenRequests.js";
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
  devSeed: typeof devSeed;
  "domain/apps": typeof domain_apps;
  "domain/handoff": typeof domain_handoff;
  "domain/requests": typeof domain_requests;
  "domain/returnPaths": typeof domain_returnPaths;
  "domain/slices": typeof domain_slices;
  functions: typeof functions;
  http: typeof http;
  "http/contracts": typeof http_contracts;
  "http/helpers": typeof http_helpers;
  "http/httpAccessRequestHandlers": typeof http_httpAccessRequestHandlers;
  "http/httpAccountsHandler": typeof http_httpAccountsHandler;
  "http/httpAgentConnectionHandlers": typeof http_httpAgentConnectionHandlers;
  "http/httpAgentSliceHandlers": typeof http_httpAgentSliceHandlers;
  "http/httpAppsHandler": typeof http_httpAppsHandler;
  "http/httpClaimHandler": typeof http_httpClaimHandler;
  "http/httpCredentialsHandler": typeof http_httpCredentialsHandler;
  "http/mint": typeof http_mint;
  "http/oauth": typeof http_oauth;
  "lib/errors": typeof lib_errors;
  "lib/json": typeof lib_json;
  "lib/requests": typeof lib_requests;
  "lib/responses": typeof lib_responses;
  "lib/secrets": typeof lib_secrets;
  "lib/tokenEncryption": typeof lib_tokenEncryption;
  probe: typeof probe;
  probeSchema: typeof probeSchema;
  "tables/agentConnectionExpiry": typeof tables_agentConnectionExpiry;
  "tables/agentConnections": typeof tables_agentConnections;
  "tables/agentDashboard": typeof tables_agentDashboard;
  "tables/connections/actions": typeof tables_connections_actions;
  "tables/connections/helpers": typeof tables_connections_helpers;
  "tables/connections/mutations": typeof tables_connections_mutations;
  "tables/connections/queries": typeof tables_connections_queries;
  "tables/oauthStates/finish": typeof tables_oauthStates_finish;
  "tables/oauthStates/mutations": typeof tables_oauthStates_mutations;
  "tables/oauthStates/queries": typeof tables_oauthStates_queries;
  "tables/slices/credentials": typeof tables_slices_credentials;
  "tables/slices/helpers": typeof tables_slices_helpers;
  "tables/slices/mutations": typeof tables_slices_mutations;
  "tables/slices/queries": typeof tables_slices_queries;
  "tables/slices/sliceRequestClaims": typeof tables_slices_sliceRequestClaims;
  "tables/slices/sliceRequestExpiry": typeof tables_slices_sliceRequestExpiry;
  "tables/slices/sliceRequests": typeof tables_slices_sliceRequests;
  "tables/slices/tokenRequestClaims": typeof tables_slices_tokenRequestClaims;
  "tables/slices/tokenRequests": typeof tables_slices_tokenRequests;
  users: typeof users;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
