/// <reference types="vite/client" />
import { managedFixture } from "./helpers/connect";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const t = () => convexTest(schema, modules);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("multi-account bindings", () => {
  test("one slice allows two Slack accounts and pins approval to the chosen binding", async () => {
    const test = t();
    const userId = await test.run(async (ctx) =>
      ctx.db.insert("users", { name: "Owner", email: "owner@example.com" }),
    );
    for (const [providerUserId, login] of [
      ["sub-x", "Alice (Workspace)"],
      ["sub-y", "Bob (Workspace)"],
    ] as const) {
      await test.mutation(
        internal.connect.connections.save,
        managedFixture({ userId, providerUserId, login }),
      );
    }
    const backend = test.withIdentity({ subject: `${userId}|session-1` });
    const accounts = (
      await backend.query(api.tables.connections.queries.statusesForApps, {
        apps: ["slack"],
      })
    )[0].accounts;
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Both accounts",
        ttlMs: 60_000,
        apps: ["slack"],
        mintPolicy: "approve",
        bindings: accounts.map((account) => ({
          app: "slack" as const,
          connectionId: account.id,
        })),
      },
    );
    const discovered = await test.query(
      internal.tables.slices.queries.discoverAccounts,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
        now: Date.now(),
      },
    );
    if (!discovered.ok) throw new Error("expected account discovery");
    expect(discovered.accounts.map((account) => account.login)).toEqual([
      "Alice (Workspace)",
      "Bob (Workspace)",
    ]);
    const ambiguous = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
      },
    );
    expect(ambiguous).toMatchObject({
      ok: false,
      code: "ACCOUNT_SELECTION_REQUIRED",
    });
    const selected = discovered.accounts[1];
    const authorized = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
        bindingId: selected.bindingId,
      },
    );
    expect(authorized).toMatchObject({
      ok: true,
      bindingId: selected.bindingId,
      connectionId: accounts[1].id,
    });
    if (!authorized.ok) throw new Error("expected authorization");
    const pending = await test.mutation(
      internal.tables.slices.tokenRequestClaims.createPending,
      {
        sliceId: authorized.sliceId,
        app: "slack",
        bindingId: authorized.bindingId,
      },
    );
    if (!pending.ok) throw new Error("expected pending request");
    const boardRequest = await backend.query(
      api.tables.slices.tokenRequests.get,
      {
        publicToken: pending.publicToken,
      },
    );
    expect(boardRequest?.accountLogin).toBe("Bob (Workspace)");
    await backend.mutation(api.tables.slices.tokenRequests.decide, {
      publicToken: pending.publicToken,
      decision: "approved",
    });
    const claim = await test.mutation(
      internal.tables.slices.tokenRequestClaims.resolveClaim,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId: pending.requestId,
      },
    );
    expect(claim).toMatchObject({
      ok: true,
      bindingId: selected.bindingId,
      connectionId: accounts[1].id,
    });
    await backend.mutation(api.tables.slices.mutations.setBinding, {
      sliceToken: created.sliceToken,
      app: "slack",
      connectionId: accounts[1].id,
      enabled: false,
    });
    const unavailable = await test.mutation(
      internal.tables.slices.tokenRequestClaims.resolveClaim,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId: pending.requestId,
      },
    );
    expect(unavailable).toMatchObject({ ok: false, code: "APP_UNAVAILABLE" });
    const stillAllowed = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
      },
    );
    expect(stillAllowed).toMatchObject({
      ok: true,
      connectionId: accounts[0].id,
    });
  });
});
