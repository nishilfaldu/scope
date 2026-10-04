import { afterEach, expect, test, vi } from "vitest";
import { fixture } from "./access-fixture";
import { omit } from "convex-helpers";
import { api, internal } from "../convex/_generated/api";
afterEach(() => vi.unstubAllEnvs());
test("repeatable seed preserves real records and owner decisions store actual timestamps", async () => {
  const f = await fixture();
  vi.stubEnv("CONVEX_CLOUD_URL", "https://bright-dinosaur-692.convex.cloud");
  const legacyId = await f.t.run(async (ctx) => {
    const row = (await ctx.db.get("connectedAccounts", f.accountId))!;
    return ctx.db.insert("connectedAccounts", {
      ...omit(row, ["_id", "_creationTime"]),
      label: "Old fixture",
      authorizationKey: "legacy-demo",
      connect: {
        ...row.connect,
        issuer: "https://scope-ui-demo.invalid",
        subjectId: "scope-ui-review-v1:active",
      },
    });
  });
  expect(
    await f.t.mutation(internal.uiReview.seed, { ownerId: f.actor.subject }),
  ).toBe(42);
  const first = await f.owner.query(api.access.forOwner, {
    section: "pending",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  const id = first.page[0]._id;
  await f.owner.mutation(api.access.decide, { id, approve: true, minutes: 30 });
  const decided = await f.owner.query(api.access.requestForOwner, {
    reference: id,
  });
  expect(decided?.status).toBe("active");
  expect(decided?.approvedAt).toBeTypeOf("number");
  expect(decided?.until).toBe(decided!.approvedAt! + 30 * 60_000);
  await f.t.mutation(internal.uiReview.seed, { ownerId: f.actor.subject });
  expect(await f.owner.query(api.access.pendingCount, {})).toBe(3);
  expect(
    (
      await f.owner.query(api.accounts.forOwner, {
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page,
  ).toHaveLength(2);
  expect(
    (await f.t.run((ctx) => ctx.db.get("connectedAccounts", f.accountId)))
      ?.label,
  ).toBe("Owner (Workspace)");
  expect(
    (await f.t.run((ctx) => ctx.db.get("connectedAccounts", legacyId)))
      ?.visible,
  ).toBe(false);
  const history = await f.owner.query(api.access.forOwner, {
    section: "history",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(history.page).toHaveLength(20);
  expect(history.isDone).toBe(false);
});
test("seed refuses any other deployment", async () => {
  const f = await fixture();
  vi.stubEnv("CONVEX_CLOUD_URL", "https://production.example.convex.cloud");
  await expect(
    f.t.mutation(internal.uiReview.seed, { ownerId: f.actor.subject }),
  ).rejects.toThrow("Personal dev only");
  expect(
    (
      await f.owner.query(api.accounts.forOwner, {
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page,
  ).toHaveLength(1);
});
