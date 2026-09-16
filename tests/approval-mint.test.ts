/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { ensurePassport } from "../convex/tables/passports";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

async function signedIn(test: ReturnType<typeof t>) {
  const userId = await test.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Nishil Faldu",
      email: "nishil@example.com",
    });
  });
  await test.run(async (ctx) => {
    await ensurePassport(ctx, userId);
  });
  await test.mutation(internal.tables.connections.mutations.saveConnection, {
    userId,
    provider: "github",
    accessToken: "ghs_standing_token",
    login: "octocat",
    providerUserId: "1",
  });
  return {
    backend: test.withIdentity({ subject: `${userId}|session-1` }),
    userId,
  };
}

describe("auto mint policy unchanged", () => {
  test("default mintPolicy is auto and authorizeCreate returns auto", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Auto agent",
      ttlMs: 60_000,
      apps: ["github"],
    });
    expect(created.mintPolicy).toBe("auto");
    const allowed = await test.mutation(
      internal.tables.slices.credentials.authorizeCreate,
      {
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
        refresh: false,
      },
    );
    expect(allowed).toMatchObject({
      ok: true,
      mintPolicy: "auto",
      app: "github",
    });
  });

  test("POST /api/credentials still mints immediately for auto", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Auto http",
      ttlMs: 60_000,
      apps: ["github"],
      mintPolicy: "auto",
    });
    const response = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.tokenType).toBe("Bearer");
    expect(body.app).toBe("github");
    expect(body).not.toHaveProperty("requestId");
  });
});

describe("approve-gated mint", () => {
  test("POST /api/credentials returns 202 APPROVAL_REQUIRED and claim mints after approve", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Approve agent",
      ttlMs: 60_000,
      apps: ["github"],
      mintPolicy: "approve",
    });
    expect(created.mintPolicy).toBe("approve");

    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      }),
    });
    expect(requested.status).toBe(202);
    const pendingBody = await requested.json();
    expect(pendingBody).toMatchObject({
      code: "APPROVAL_REQUIRED",
      status: "pending",
      app: "github",
    });
    expect(pendingBody.requestId).toBeTruthy();
    expect(pendingBody.accessToken).toBeUndefined();

    const stillPending = await test.fetch("/api/credentials/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId: pendingBody.requestId,
      }),
    });
    expect(stillPending.status).toBe(202);
    expect(await stillPending.json()).toMatchObject({
      code: "APPROVAL_REQUIRED",
      status: "pending",
    });

    await backend.mutation(api.tables.slices.accessRequests.decide, {
      requestId: pendingBody.requestId,
      decision: "approved",
    });

    const claimed = await test.fetch("/api/credentials/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId: pendingBody.requestId,
      }),
    });
    expect(claimed.status).toBe(200);
    const minted = await claimed.json();
    expect(minted.accessToken).toBeTruthy();
    expect(minted.app).toBe("github");
    expect(minted.requestId).toBe(pendingBody.requestId);
    expect(JSON.stringify(minted)).not.toMatch(/ghs_/);

    const secondClaim = await test.fetch("/api/credentials/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        requestId: pendingBody.requestId,
      }),
    });
    expect(secondClaim.status).toBe(403);
    expect(await secondClaim.json()).toMatchObject({
      code: "APPROVAL_EXPIRED",
    });
  });

  test("deny returns APPROVAL_DENIED on claim", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Deny agent",
      ttlMs: 60_000,
      apps: ["github"],
      mintPolicy: "approve",
    });
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      }),
    });
    const { requestId } = await requested.json();
    await backend.mutation(api.tables.slices.accessRequests.decide, {
      requestId,
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
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Expire agent",
      ttlMs: 60_000,
      apps: ["github"],
      mintPolicy: "approve",
    });
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      }),
    });
    const { requestId } = await requested.json();
    await test.run(async (ctx) => {
      await ctx.db.patch("accessRequests", requestId, {
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
    const created = await backend.mutation(api.tables.slices.mutations.create, {
      name: "Claim window",
      ttlMs: 60_000,
      apps: ["github"],
      mintPolicy: "approve",
    });
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      }),
    });
    const { requestId } = await requested.json();
    await backend.mutation(api.tables.slices.accessRequests.decide, {
      requestId,
      decision: "approved",
    });
    await test.run(async (ctx) => {
      await ctx.db.patch("accessRequests", requestId, {
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

  test("discovery documents claim route and approval error codes", async () => {
    const response = await t().fetch("/", { method: "GET" });
    expect(response.status).toBe(200);
    const body = await response.json();
    const paths = body.routes.map(
      (route: { method: string; path: string }) =>
        `${route.method} ${route.path}`,
    );
    expect(paths).toContain("POST /api/credentials/claim");
    expect(body.errors.APPROVAL_REQUIRED).toBeTruthy();
    expect(body.errors.APPROVAL_DENIED).toBeTruthy();
    expect(body.errors.APPROVAL_EXPIRED).toBeTruthy();
  });
});
