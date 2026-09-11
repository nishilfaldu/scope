/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function t() {
  return convexTest(schema, modules);
}

describe("passport audit trail", () => {
  test("mint records an issued event with board actor and granted scopes", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "PR agent",
      ttlMs: 60_000,
      apps: ["demo", "github"],
    });
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page).toHaveLength(1);
    const event = history.page[0];
    expect(event.kind).toBe("issued");
    expect(event.actorType).toBe("board");
    expect(event.scopes).toEqual(["demo", "github"]);
    expect(event.outcome).toBe("allowed");
    expect(event.reason).toBe("Passport minted");
    const chain = await test.query(api.audit.chainStatus, {
      passportId: minted.id,
    });
    expect(chain).toEqual({
      eventCount: 1,
      expectedSeq: 1,
      intact: true,
    });
  });

  test("revoke records a revoked event and refuses unknown passports", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Temp",
      ttlMs: 60_000,
      apps: ["demo"],
    });
    await test.mutation(api.passports.revoke, {
      passportId: minted.passportId,
    });
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      kind: "revoked",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page).toHaveLength(1);
    expect(history.page[0]?.outcome).toBe("allowed");
    expect(history.page[0]?.reason).toBe("Revoked by board");

    await expect(
      test.mutation(api.passports.revoke, { passportId: "pp_missing" }),
    ).rejects.toThrow(/Passport not found/);
  });

  test("presenting a passport records presented, verified, and used when allowed", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Echo",
      ttlMs: 60_000,
      apps: ["demo"],
    });
    const decision = await test.mutation(internal.audit.recordPresentation, {
      passportId: minted.id,
      action: "demo.echo",
      argsPreview: "{}",
    });
    expect(decision.allowRun).toBe(true);
    await test.mutation(internal.audit.recordUse, {
      passportId: minted.id,
      action: "demo.echo",
      argsPreview: "{}",
      ok: true,
      status: 200,
      error: null,
    });
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page.map((event) => event.kind)).toEqual([
      "used",
      "verified",
      "presented",
      "issued",
    ]);
    expect(history.page[0]?.outcome).toBe("allowed");
    const chain = await test.query(api.audit.chainStatus, {
      passportId: minted.id,
    });
    expect(chain.intact).toBe(true);
    expect(chain.eventCount).toBe(4);
  });

  test("denied invoke still records presented and verified, and does not record used", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Demo only",
      ttlMs: 60_000,
      apps: ["demo"],
    });
    const decision = await test.mutation(internal.audit.recordPresentation, {
      passportId: minted.id,
      action: "github.repos.list",
      argsPreview: "{}",
    });
    expect(decision).toEqual({
      allowRun: false,
      status: 403,
      reason: "Action not permitted",
    });
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page.map((event) => event.kind)).toEqual([
      "verified",
      "presented",
      "issued",
    ]);
    expect(history.page[0]?.outcome).toBe("denied");
    expect(history.page[0]?.reason).toBe("Action not permitted");
  });

  test("history filters by kind, outcome, and actor", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Filter me",
      ttlMs: 60_000,
      apps: ["demo"],
    });
    await test.mutation(internal.audit.recordPresentation, {
      passportId: minted.id,
      action: "missing.action",
      argsPreview: "{}",
    });
    const denied = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      outcome: "denied",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(denied.page.every((event) => event.outcome === "denied")).toBe(true);
    expect(denied.page).toHaveLength(1);

    const presented = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      kind: "presented",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(presented.page).toHaveLength(1);
    expect(presented.page[0]?.kind).toBe("presented");

    const agent = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      actorType: "agent",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(agent.page.every((event) => event.actorType === "agent")).toBe(true);
    expect(agent.page.length).toBeGreaterThan(0);

    const unknown = await test.query(api.audit.listHistory, {
      passportId: "not-an-id",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(unknown.page).toEqual([]);
  });

  test("expireDue records expired once and is idempotent", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Short",
      ttlMs: 60_000,
      apps: ["demo"],
    });
    await test.run(async (ctx) => {
      await ctx.db.patch("passports", minted.id, {
        expiresAt: Date.now() - 1_000,
      });
    });
    const first = await test.mutation(internal.audit.expireDue, {});
    const second = await test.mutation(internal.audit.expireDue, {});
    expect(first).toBe(1);
    expect(second).toBe(0);
    const passport = await test.query(api.passports.get, {
      passportId: minted.id,
      now: Date.now(),
    });
    expect(passport?.lifetimeStatus).toBe("expired");
    const expired = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      kind: "expired",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(expired.page).toHaveLength(1);
    expect(expired.page[0]?.actorType).toBe("system");
    expect(expired.page[0]?.reason).toBe("Time to live elapsed");
  });

  test("public api cannot edit or delete audit records", () => {
    expect(api.audit).not.toHaveProperty("remove");
    expect(api.audit).not.toHaveProperty("delete");
    expect(api.audit).not.toHaveProperty("patch");
    expect(api.audit).not.toHaveProperty("replace");
    expect(api.passports).not.toHaveProperty("appendLog");
  });
});
