import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import aggregateTest from "@convex-dev/aggregate/test";
import retrierTest from "@convex-dev/action-retrier/test";
import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { vi } from "vitest";
const modules = import.meta.glob("../convex/**/*.ts");
export const secret = "service-test-secret",
  scopes = ["channels:read", "identify"];
export async function fixture(crashFirstPush = false) {
  vi.stubEnv("SCOPE_SERVICE_SECRET", secret);
  vi.stubEnv("WORKOS_CLIENT_ID", "web-client");
  vi.stubEnv("SCOPE_CLI_CLIENT_ID", "cli-client");
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "accessCounts");
  let crash = crashFirstPush;
  t.registerComponent("actionRetrier", retrierTest.schema, {
    ...retrierTest.modules,
    "./component/run.ts": async () => {
      const original = await retrierTest.modules["./component/run.ts"]();
      return {
        ...original,
        execute: internalActionGeneric({
          args: { runId: v.id("runs") },
          returns: v.null(),
          handler: async (ctx, args) => {
            if (crash) {
              crash = false;
              throw new Error("Simulated worker crash");
            }
            await original.execute._handler(ctx, args);
            return null;
          },
        }),
      };
    },
  });

  const issuer = "https://api.workos.com/user_management/web-client";
  const identity = {
    subject: "user_owner",
    issuer,
    client_id: "web-client",
    sid: "session_browser",
  };
  const owner = t.withIdentity(identity),
    stranger = t.withIdentity({ ...identity, subject: "user_stranger" });
  const actor = {
    secret,
    issuer,
    subject: "user_owner",
    clientId: "cli-client",
    sessionId: "session_cli",
  };
  const setup = {
    secret,
    providerId: "slack" as const,
    providerName: "Slack",
    connectorId: "connector",
    issuer: "https://scope.convex.site",
    requestedScopes: scopes,
    proofHash: "a".repeat(64),
  };
  const completion = {
    secret,
    activate: true,
    providerUserId: "U1",
    providerTenantId: "T1",
    label: "Owner (Workspace)",
    installationId: "I1",
    grantedScopes: scopes,
  };
  const initial = await owner.mutation(api.accounts.beginConnection, setup);
  const { accountId } = await owner.mutation(api.accounts.completeConnection, {
    ...completion,
    id: initial.id,
  });
  const requestArgs = {
    ...actor,
    accountId,
    agentName: "Assistant",
    reason: "Find project channels",
  };
  async function request(approve = true) {
    const r = await t.mutation(api.access.request, requestArgs);
    await owner.mutation(api.access.decide, { id: r.id, approve, minutes: 30 });
    return r;
  }
  return {
    t,
    owner,
    stranger,
    actor,
    accountId,
    requestArgs,
    request,
    setup,
    completion,
  };
}
