/// <reference types="vite/client" />
import { managedFixture, managedGrant } from "./helpers/connect";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

async function signedIn(test: ReturnType<typeof t>) {
  const userId = await test.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Nishil Faldu",
      email: "nishil@example.com",
    });
  });
  await test.mutation(
    internal.connect.connections.save,
    managedFixture({ userId, login: "octocat", providerUserId: "1" }),
  );
  return {
    backend: test.withIdentity({ subject: `${userId}|session-1` }),
    userId,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("auto mint policy", () => {
  test("bridge fetch rejection yields SHORT_LIVED_UNAVAILABLE not 500", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Refresh throw",
        ttlMs: 60_000,
        apps: ["slack"],
        mintPolicy: "auto",
      },
    );
    const response = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
      }),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("SHORT_LIVED_UNAVAILABLE");
    expect(body).not.toHaveProperty("accessToken");
  });
});

describe("approve-gated mint", () => {
  test("the slice can cancel its pending token request", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Cancel request",
        ttlMs: 60_000,
        apps: ["slack"],
        mintPolicy: "approve",
      },
    );
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
      }),
    });
    const { requestId } = await requested.json();
    const cancelled = await test.fetch("/api/credentials/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId,
      }),
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ status: "cancelled" });

    const claim = await test.fetch("/api/credentials/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId,
      }),
    });
    expect(claim.status).toBe(403);
    expect(await claim.json()).toMatchObject({ code: "APPROVAL_EXPIRED" });
  });

  test("failed Connect request leaves an approved request claimable", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Retry agent",
        ttlMs: 60_000,
        apps: ["slack"],
        mintPolicy: "approve",
      },
    );
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
      }),
    });
    const { requestId, approvalUrl } = await requested.json();
    await backend.mutation(api.tables.slices.tokenRequests.decide, {
      publicToken: approvalUrl.split("/requests/token/")[1],
      decision: "approved",
    });
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValue(json(managedGrant("xoxe.xoxp-retry")));
    const claim = () =>
      test.fetch("/api/credentials/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sliceToken: created.sliceToken,
          sliceSecret: created.sliceSecret,
          requestId,
        }),
      });
    const failed = await claim();
    expect(failed.status).toBe(503);
    expect(
      await test.run(
        async (ctx) => (await ctx.db.get("tokenRequests", requestId))?.status,
      ),
    ).toBe("approved");
    const retried = await claim();
    expect(retried.status).toBe(200);
    expect((await retried.json()).accessToken).toBe("xoxe.xoxp-retry");
  });

  test("deny returns APPROVAL_DENIED on claim", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Deny agent",
        ttlMs: 60_000,
        apps: ["slack"],
        mintPolicy: "approve",
      },
    );
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
      }),
    });
    const { requestId, approvalUrl } = await requested.json();
    await backend.mutation(api.tables.slices.tokenRequests.decide, {
      publicToken: approvalUrl.split("/requests/token/")[1],
      decision: "denied",
    });
    const denied = await test.fetch("/api/credentials/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId,
      }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      code: "APPROVAL_DENIED",
      error: "Credential request was denied",
    });
  });

  test("pending expiry returns APPROVAL_EXPIRED", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Expire agent",
        ttlMs: 60_000,
        apps: ["slack"],
        mintPolicy: "approve",
      },
    );
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
      }),
    });
    const { requestId } = await requested.json();
    await test.run(async (ctx) => {
      await ctx.db.patch("tokenRequests", requestId, {
        expiresAt: Date.now() - 1_000,
      });
    });
    const expired = await test.fetch("/api/credentials/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId,
      }),
    });
    expect(expired.status).toBe(403);
    expect(await expired.json()).toMatchObject({
      code: "APPROVAL_EXPIRED",
    });
  });

  test("post-approve claim window expiry returns APPROVAL_EXPIRED", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Claim window",
        ttlMs: 60_000,
        apps: ["slack"],
        mintPolicy: "approve",
      },
    );
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "slack",
      }),
    });
    const { requestId, approvalUrl } = await requested.json();
    await backend.mutation(api.tables.slices.tokenRequests.decide, {
      publicToken: approvalUrl.split("/requests/token/")[1],
      decision: "approved",
    });
    await test.run(async (ctx) => {
      await ctx.db.patch("tokenRequests", requestId, {
        expiresAt: Date.now() - 1_000,
      });
    });
    const expired = await test.fetch("/api/credentials/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId,
      }),
    });
    expect(expired.status).toBe(403);
    expect(await expired.json()).toMatchObject({
      code: "APPROVAL_EXPIRED",
    });
  });
});
