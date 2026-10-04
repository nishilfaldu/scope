/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as approvals from "../approvals.js";
import type * as clientConnections from "../clientConnections.js";
import type * as domain_apps from "../domain/apps.js";
import type * as http from "../http.js";
import type * as lib_push from "../lib/push.js";
import type * as lib_requestExpiry from "../lib/requestExpiry.js";
import type * as lib_responses from "../lib/responses.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as migrations from "../migrations.js";
import type * as notificationDelivery from "../notificationDelivery.js";
import type * as notifications from "../notifications.js";
import type * as scope from "../scope.js";
import type * as uiReview from "../uiReview.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  approvals: typeof approvals;
  clientConnections: typeof clientConnections;
  "domain/apps": typeof domain_apps;
  http: typeof http;
  "lib/push": typeof lib_push;
  "lib/requestExpiry": typeof lib_requestExpiry;
  "lib/responses": typeof lib_responses;
  "lib/secrets": typeof lib_secrets;
  migrations: typeof migrations;
  notificationDelivery: typeof notificationDelivery;
  notifications: typeof notifications;
  scope: typeof scope;
  uiReview: typeof uiReview;
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
  actionRetrier: import("@convex-dev/action-retrier/_generated/component.js").ComponentApi<"actionRetrier">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
