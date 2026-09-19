/// <reference types="vite/client" />
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

async function signedIn(
  test: ReturnType<typeof t>,
  opts: { refreshToken?: string } = {},
) {
  const userId = await test.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Nishil Faldu",
      email: "nishil@example.com",
    });
  });
  await test.mutation(internal.tables.connections.mutations.saveConnection, {
    userId,
    provider: "github",
    app: "github",
    accessToken: "ghs_standing_token",
    login: "octocat",
    providerUserId: "1",
    refreshToken: opts.refreshToken,
  });
  return {
    backend: test.withIdentity({ subject: `${userId}|session-1` }),
    userId,
  };
}

function stubGithubRefresh(mintedAccess = "ghu_short_lived_minted") {
  vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.testapp");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    json({
      access_token: mintedAccess,
      refresh_token: "ghr_rotated_refresh",
      expires_in: 28_800,
      token_type: "bearer",
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("auto mint policy", () => {
  test("POST /api/credentials mints a short-lived token distinct from standing", async () => {
    const test = t();
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });
    stubGithubRefresh("ghu_auto_minted");
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Auto http",
        ttlMs: 60_000,
        apps: ["github"],
        mintPolicy: "auto",
      },
    );
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
    expect(body.accessToken).toBe("ghu_auto_minted");
    expect(body.accessToken).not.toBe("ghs_standing_token");
    expect(body.tokenType).toBe("Bearer");
    expect(body.app).toBe("github");
    expect(body.expiresIn).toBeGreaterThan(7 * 60 * 60);
    expect(body).not.toHaveProperty("requestId");
    expect(body).not.toHaveProperty("refreshToken");
    expect(JSON.stringify(body)).not.toMatch(/ghr_/);
  });

  test("standing-only GitHub connection hard-fails auto mint", async () => {
    const test = t();
    const { backend } = await signedIn(test);
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Standing only",
        ttlMs: 60_000,
        apps: ["github"],
        mintPolicy: "auto",
      },
    );
    const response = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      }),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("SHORT_LIVED_UNAVAILABLE");
    expect(body).not.toHaveProperty("accessToken");
    expect(JSON.stringify(body)).not.toMatch(/ghs_standing_token/);
  });

  test("refresh fetch rejection yields SHORT_LIVED_UNAVAILABLE not 500", async () => {
    const test = t();
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });
    vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.testapp");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Refresh throw",
        ttlMs: 60_000,
        apps: ["github"],
        mintPolicy: "auto",
      },
    );
    const response = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      }),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("SHORT_LIVED_UNAVAILABLE");
    expect(body).not.toHaveProperty("accessToken");
    expect(JSON.stringify(body)).not.toMatch(/ghs_standing_token/);
  });
});

describe("approve-gated mint", () => {
  test("the slice can cancel its pending token request", async () => {
    const test = t();
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Cancel request",
        ttlMs: 60_000,
        apps: ["github"],
        mintPolicy: "approve",
      },
    );
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

  test("failed refresh leaves an approved request claimable", async () => {
    const test = t();
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Retry agent",
        ttlMs: 60_000,
        apps: ["github"],
        mintPolicy: "approve",
      },
    );
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
      }),
    });
    const { requestId, approvalUrl } = await requested.json();
    await backend.mutation(api.tables.slices.tokenRequests.decide, {
      publicToken: approvalUrl.split("/requests/token/")[1],
      decision: "approved",
    });
    vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.testapp");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValue(
        json({
          access_token: "ghu_retry",
          refresh_token: "ghr_next",
          expires_in: 3600,
        }),
      );
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
    expect((await retried.json()).accessToken).toBe("ghu_retry");
  });

  test("revocation during refresh blocks delivery", async () => {
    const test = t();
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Race agent",
        ttlMs: 60_000,
        apps: ["github"],
      },
    );
    vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.testapp");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await backend.mutation(api.tables.slices.mutations.revoke, {
        sliceToken: created.sliceToken,
      });
      return json({
        access_token: "ghu_after_revoke",
        refresh_token: "ghr_next",
        expires_in: 3600,
      });
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
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "REVOKED" });
  });

  test("POST /api/credentials returns 202 APPROVAL_REQUIRED and claim mints short-lived after approve", async () => {
    const test = t();
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });
    stubGithubRefresh("ghu_claim_minted");
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Approve agent",
        ttlMs: 60_000,
        apps: ["github"],
        mintPolicy: "approve",
      },
    );
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
    expect(pendingBody).not.toHaveProperty("accessToken");

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

    await backend.mutation(api.tables.slices.tokenRequests.decide, {
      publicToken: pendingBody.approvalUrl.split("/requests/token/")[1],
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
    expect(minted.accessToken).toBe("ghu_claim_minted");
    expect(minted.accessToken).not.toBe("ghs_standing_token");
    expect(minted.app).toBe("github");
    expect(minted.requestId).toBe(pendingBody.requestId);
    expect(minted).not.toHaveProperty("refreshToken");
    expect(JSON.stringify(minted)).not.toMatch(/ghr_/);

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
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Deny agent",
        ttlMs: 60_000,
        apps: ["github"],
        mintPolicy: "approve",
      },
    );
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
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
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Expire agent",
        ttlMs: 60_000,
        apps: ["github"],
        mintPolicy: "approve",
      },
    );
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
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });
    const created = await backend.mutation(
      internal.tables.slices.mutations.createFixture,
      {
        name: "Claim window",
        ttlMs: 60_000,
        apps: ["github"],
        mintPolicy: "approve",
      },
    );
    const requested = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: created.sliceToken,
        sliceSecret: created.sliceSecret,
        app: "github",
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

  test("discovery documents claim route and approval error codes", async () => {
    const response = await t().fetch("/", { method: "GET" });
    expect(response.status).toBe(200);
    const body = await response.json();
    const paths = body.routes.map(
      (route: { method: string; path: string }) =>
        `${route.method} ${route.path}`,
    );
    expect(paths).toContain("POST /api/credentials/claim");
    expect(body.errors).toContain("APPROVAL_REQUIRED");
    expect(body.errors).toContain("APPROVAL_DENIED");
    expect(body.errors).toContain("APPROVAL_EXPIRED");
    expect(body.errors).toContain("SHORT_LIVED_UNAVAILABLE");
  });
});
