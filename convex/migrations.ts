import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import schema from "./schema";
import { initializeRequestExpiry } from "./lib/requestExpiry";

const migrations = new Migrations(components.migrations, { schema });
export const requestExpiry = migrations.define({
  table: "approvalRequests",
  migrateOne: initializeRequestExpiry,
});
export const run = migrations.runner([internal.migrations.requestExpiry]);
