/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("agent onboarding approval link", () => {
  test("create → approvalUrl is board origin → approve → claim returns slice creds without prior ss_", async () => {
    const test = t();
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });

    const created = await test.fetch("/api/access-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentName: "Chat agent",
        apps: ["github"],
        ttlMs: 60_000,
        reason: "triage inbox",
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.status).toBe("pending");
    expect(body.claimHandle).toMatch(/^ch_/);
    expect(body.approvalUrl).toMatch(
      /^http:\/\/localhost:3000\/requests\/new\/ar_/,
    );
    expect(body.approvalUrl.startsWith("http://localhost:3000/")).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/ss_/);
    expect(body).not.toHaveProperty("sliceSecret");
    expect(body).not.toHaveProperty("sliceToken");

    const pendingClaim = await test.fetch("/api/access-requests/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: body.claimHandle }),
    });
    expect(pendingClaim.status).toBe(202);
    const pendingBody = await pendingClaim.json();
    expect(pendingBody.code).toBe("APPROVAL_REQUIRED");
    expect(pendingBody.approvalUrl).toBe(body.approvalUrl);

    const publicToken = body.approvalUrl.split("/requests/new/")[1];
    const preview = await backend.query(
      api.tables.slices.accessRequests.getNewSlice,
      { publicToken },
    );
    expect(preview?.kind).toBe("onboarding");
    expect(preview?.agentName).toBe("Chat agent");

    await backend.mutation(api.tables.slices.accessRequests.decide, {
      publicToken: body.approvalUrl.split("/requests/new/")[1],
      decision: "approved",
    });

    const status = await test.fetch("/api/access-requests/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: body.claimHandle }),
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      status: "approved",
      approvalUrl: body.approvalUrl,
    });

    const claimed = await test.fetch("/api/access-requests/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: body.claimHandle }),
    });
    expect(claimed.status).toBe(200);
    const sliceCreds = await claimed.json();
    expect(sliceCreds.sliceToken).toMatch(/^st_/);
    expect(sliceCreds.sliceSecret).toMatch(/^ss_/);
    expect(sliceCreds.mintPolicy).toBe("auto");
    expect(sliceCreds.apps).toEqual(["github"]);
    expect(sliceCreds.name).toBe("Chat agent");

    // Second claim is single-use.
    const second = await test.fetch("/api/access-requests/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: body.claimHandle }),
    });
    expect(second.status).toBe(403);
    expect(await second.json()).toMatchObject({ code: "APPROVAL_EXPIRED" });

    // Claimed slice works for short-lived mint path without user pasting ss_ earlier.
    vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.testapp");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "ghu_after_onboarding",
          refresh_token: "ghr_rotated",
          expires_in: 28_800,
          token_type: "bearer",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const minted = await test.fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sliceToken: sliceCreds.sliceToken,
        sliceSecret: sliceCreds.sliceSecret,
        app: "github",
      }),
    });
    expect(minted.status).toBe(200);
    expect(await minted.json()).toMatchObject({
      accessToken: "ghu_after_onboarding",
      app: "github",
    });
  });

  test("deny returns APPROVAL_DENIED on claim", async () => {
    const test = t();
    const { backend } = await signedIn(test, {
      refreshToken: "ghr_refresh_token",
    });
    const created = await test.fetch("/api/access-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentName: "Denied agent",
        apps: ["github"],
        ttlMs: 60_000,
      }),
    });
    const body = await created.json();
    await backend.mutation(api.tables.slices.accessRequests.decide, {
      publicToken: body.approvalUrl.split("/requests/new/")[1],
      decision: "denied",
    });
    const denied = await test.fetch("/api/access-requests/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: body.claimHandle }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "APPROVAL_DENIED" });
  });

  test("expire returns APPROVAL_EXPIRED", async () => {
    const test = t();
    await signedIn(test, { refreshToken: "ghr_refresh_token" });
    const created = await test.fetch("/api/access-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentName: "Expired agent",
        apps: ["github"],
        ttlMs: 60_000,
      }),
    });
    const body = await created.json();
    await test.run(async (ctx) => {
      await ctx.db.patch("accessRequests", body.requestId, {
        expiresAt: Date.now() - 1_000,
      });
    });
    const expired = await test.fetch("/api/access-requests/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimHandle: body.claimHandle }),
    });
    expect(expired.status).toBe(403);
    expect(await expired.json()).toMatchObject({ code: "APPROVAL_EXPIRED" });
  });

  test("discovery documents onboarding routes and board approval story", async () => {
    const response = await t().fetch("/", { method: "GET" });
    expect(response.status).toBe(200);
    const body = await response.json();
    const paths = body.routes.map(
      (route: { method: string; path: string }) =>
        `${route.method} ${route.path}`,
    );
    expect(paths).toContain("POST /api/access-requests");
    expect(paths).toContain("POST /api/access-requests/status");
    expect(paths).toContain("POST /api/access-requests/claim");
    expect(body.summary.toLowerCase()).toContain("future credential mints");
    expect(
      body.routes.some(
        (route: { path: string }) => route.path === "/api/access-requests",
      ),
    ).toBe(true);
  });
});
