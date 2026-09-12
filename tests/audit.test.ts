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
      apps: ["github", "slack"],
    });
    const history = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(history.page).toHaveLength(1);
    const event = history.page[0];
    expect(event.kind).toBe("issued");
    expect(event.actorType).toBe("board");
    expect(event.scopes).toEqual(["github", "slack"]);
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
      apps: ["github"],
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

  test("history filters by kind, outcome, and actor", async () => {
    const test = t();
    const minted = await test.mutation(api.passports.mint, {
      name: "Filter me",
      ttlMs: 60_000,
      apps: ["github"],
    });
    await test.run(async (ctx) => {
      await ctx.db.patch("passports", minted.id, {
        expiresAt: Date.now() - 1_000,
      });
    });
    await test.mutation(internal.audit.expireDue, {});

    const denied = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      outcome: "denied",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(denied.page.every((event) => event.outcome === "denied")).toBe(true);
    expect(denied.page).toHaveLength(1);
    expect(denied.page[0]?.kind).toBe("expired");

    const issued = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      kind: "issued",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(issued.page).toHaveLength(1);
    expect(issued.page[0]?.kind).toBe("issued");

    const system = await test.query(api.audit.listHistory, {
      passportId: minted.id,
      actorType: "system",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(system.page.every((event) => event.actorType === "system")).toBe(
      true,
    );
    expect(system.page).toHaveLength(1);

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
      apps: ["github"],
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
