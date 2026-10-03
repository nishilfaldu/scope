import {
  ActionBuilder,
  HttpActionBuilder,
  MutationBuilder,
  QueryBuilder,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { DataModel } from "./dataModel.js";

type Env = {
  readonly CONVEX_CLOUD_URL: string;
  readonly CONVEX_SITE_URL: string;
  readonly BOARD_ORIGIN: string;
  readonly CONNECT_BRIDGE_PROTECTION_COOKIE: string | undefined;
  readonly CONNECT_BRIDGE_SECRET: string | undefined;
  readonly CONNECT_BRIDGE_URL: string | undefined;
  readonly RESEND_API_KEY: string;
  readonly RESEND_FROM: string | undefined;
  readonly TOKEN_ENCRYPTION_KEY: string;
};

export declare const query: QueryBuilder<DataModel, "public">;

export declare const internalQuery: QueryBuilder<DataModel, "internal">;

export declare const mutation: MutationBuilder<DataModel, "public">;

export declare const internalMutation: MutationBuilder<DataModel, "internal">;

export declare const action: ActionBuilder<DataModel, "public">;

export declare const internalAction: ActionBuilder<DataModel, "internal">;

export declare const httpAction: HttpActionBuilder;

export declare const env: Env;

export type QueryCtx = GenericQueryCtx<DataModel>;

export type MutationCtx = GenericMutationCtx<DataModel>;

export type ActionCtx = GenericActionCtx<DataModel>;

export type DatabaseReader = GenericDatabaseReader<DataModel>;

export type DatabaseWriter = GenericDatabaseWriter<DataModel>;
