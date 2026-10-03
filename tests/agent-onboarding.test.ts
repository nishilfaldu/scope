/// <reference types="vite/client" />
import { managedFixture } from "./helpers/connect";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { sha256Hex } from "../convex/lib/secrets";

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
  await test.mutation(
    internal.connect.connections.save,
    managedFixture({ userId, login: "octocat", providerUserId: "1" }),
  );
  return {
    backend: test.withIdentity({ subject: `${userId}|session-1` }),
    userId,
  };
}

async function connectedAgent(
  test: ReturnType<typeof t>,
  userId: Awaited<ReturnType<typeof signedIn>>["userId"],
  name: string,
) {
  const secret = `acs_${name.replaceAll(" ", "_")}`;
  const id = await test.run(async (ctx) =>
    ctx.db.insert("agentConnections", {
      userId,
      agentId: `ag_${name}`,
      name,
      secretHash: await sha256Hex(secret),
      status: "active",
    }),
  );
  return { id, secret };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("agent onboarding approval link", () => {
  test("an expired idempotent request clears its recoverable claim handle", async () => {
    const test = t();
    const { userId } = await signedIn(test);
    const agent = await connectedAgent(test, userId, "Idempotent agent");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const response = await test.fetch("/api/access-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "daily-inbox-request-00000000000001",
        "x-agent-connection-id": agent.id,
        "x-agent-connection-secret": agent.secret,
      },
      body: JSON.stringify({
        apps: ["slack"],
        ttlMs: 60_000,
        reason: "Summarize the inbox",
      }),
    });
    const created = await response.json();
    expect({ status: response.status, body: created }).toMatchObject({
      status: 201,
      body: { status: "pending" },
    });

    await test.finishAllScheduledFunctions(() =>
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1),
    );

    expect(
      await test.run(async (ctx) => {
        const request = await ctx.db.get("sliceRequests", created.requestId);
        return {
          status: request?.status,
          claimHandleCipher: request?.claimHandleCipher,
        };
      }),
    ).toEqual({ status: "pending", claimHandleCipher: "" });
  });

  test("deny returns APPROVAL_DENIED on claim", async () => {
    const test = t();
    const { backend, userId } = await signedIn(test);
    const agent = await connectedAgent(test, userId, "Denied agent");
    const created = await test.fetch("/api/access-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-connection-id": agent.id,
        "x-agent-connection-secret": agent.secret,
      },
      body: JSON.stringify({
        apps: ["slack"],
        ttlMs: 60_000,
        reason: "Test denial",
      }),
    });
    const body = await created.json();
    await backend.mutation(api.tables.slices.sliceRequests.decide, {
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
    const { userId } = await signedIn(test);
    const agent = await connectedAgent(test, userId, "Expired agent");
    const created = await test.fetch("/api/access-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-connection-id": agent.id,
        "x-agent-connection-secret": agent.secret,
      },
      body: JSON.stringify({
        apps: ["slack"],
        ttlMs: 60_000,
        reason: "Test expiry",
      }),
    });
    const body = await created.json();
    await test.run(async (ctx) => {
      await ctx.db.patch("sliceRequests", body.requestId, {
        approvalDeadlineAt: Date.now() - 1_000,
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
});
