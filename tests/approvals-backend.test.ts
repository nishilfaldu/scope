import { omit } from "convex-helpers";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { fixture, scopes, secret } from "./access-fixture";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
test("owner and immutable session claims gate access; names never bind authority", async () => {
  const f = await fixture(),
    r = await f.request();
  await expect(
    f.stranger.mutation(api.access.decide, {
      id: r.id,
      approve: true,
      minutes: 30,
    }),
  ).rejects.toThrow();
  for (const override of [
    { subject: "user_stranger" },
    { sessionId: "session_other" },
    { issuer: "https://wrong" },
    { clientId: "other" },
    { secret: "wrong" },
  ])
    await expect(
      f.t.query(api.access.status, { ...f.actor, ...override, id: r.id }),
    ).rejects.toThrow();
  const separate = await f.t.mutation(api.access.request, {
    ...f.requestArgs,
    sessionId: "session_other",
  });
  expect(separate.id).not.toBe(r.id);
  expect(separate.status).toBe("pending");
  const view = await f.owner.query(api.access.requestForOwner, {
    reference: r.id,
  });
  expect(view).not.toHaveProperty("receiptProof");
  expect(
    await f.stranger.query(api.access.requestForOwner, { reference: r.id }),
  ).toBeNull();
});
test("concurrent pending requests reuse one record and enqueue one push", async () => {
  const f = await fixture();
  await f.owner.mutation(api.notifications.subscribe, {
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    p256dh: "public",
    auth: "private",
  });
  const rows = await Promise.all(
    Array.from({ length: 8 }, () =>
      f.t.mutation(api.access.request, f.requestArgs),
    ),
  );
  expect(new Set(rows.map((r) => r.id)).size).toBe(1);
  expect(rows.filter((r) => r.created)).toHaveLength(1);
  expect(await f.owner.query(api.access.pendingCount, {})).toBe(1);
});
test("approval starts its duration at decision and collection or receipt never extends it", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const f = await fixture();
  const r = await f.t.mutation(api.access.request, f.requestArgs);
  vi.setSystemTime(Date.now() + 20 * 60_000);
  const approvedAt = Date.now();
  await f.owner.mutation(api.access.decide, {
    id: r.id,
    approve: true,
    minutes: 15,
  });
  const first = await f.t.mutation(api.access.authorizeCollection, {
    ...f.actor,
    id: r.id,
    grantVersion: 1,
    grantedScopes: scopes,
  });
  vi.setSystemTime(Date.now() + 60_000);
  const second = await f.t.mutation(api.access.authorizeCollection, {
    ...f.actor,
    id: r.id,
    grantVersion: 1,
    grantedScopes: scopes,
  });
  await f.t.mutation(api.access.acknowledge, {
    ...f.actor,
    id: r.id,
    receiptProof: first.receiptProof,
  });
  const reused = await f.t.mutation(api.access.request, {
    ...f.requestArgs,
    reason: "Another purpose",
    agentName: "Different label",
  });
  expect(reused.id).toBe(r.id);
  expect(reused.created).toBe(false);
  const row = await f.t.query(api.access.status, { ...f.actor, id: r.id });
  expect(row.approvedAt).toBe(approvedAt);
  expect(row.until).toBe(approvedAt + 15 * 60_000);
  expect(first.until).toBe(second.until);
  expect(row.collectionCount).toBe(2);
  expect(row.status).toBe("active");
  vi.setSystemTime(row.waitingUntil);
  await f.t.mutation(internal.access.expire, {
    id: r.id,
    phase: "pending",
    deadline: row.waitingUntil,
  });
  expect(
    (await f.t.query(api.access.status, { ...f.actor, id: r.id })).status,
  ).toBe("active");
  vi.setSystemTime(row.until!);
  await f.t.mutation(internal.access.expire, {
    id: r.id,
    phase: "active",
    deadline: row.until!,
  });
  expect(
    (await f.owner.query(api.access.requestForOwner, { reference: r.id }))
      ?.section,
  ).toBe("history");
  await expect(
    f.t.mutation(api.access.authorizeCollection, {
      ...f.actor,
      id: r.id,
      grantVersion: 1,
      grantedScopes: scopes,
    }),
  ).rejects.toThrow();
});
test("ending, disconnecting, changed grant and changed permissions fence final delivery", async () => {
  for (const change of ["end", "disconnect", "version", "scopes"]) {
    const f = await fixture(),
      r = await f.request();
    expect(
      (
        await f.t.query(api.access.preflight, {
          ...f.actor,
          id: r.id,
          now: Date.now(),
        })
      ).status,
    ).toBe("acquire");
    if (change === "end") await f.owner.mutation(api.access.end, { id: r.id });
    if (change === "disconnect")
      await f.owner.mutation(api.accounts.block, {
        secret,
        id: f.accountId,
        grantVersion: 1,
      });
    if (change === "version" || change === "scopes")
      await f.t.run((ctx) =>
        ctx.db.patch(
          "connectedAccounts",
          f.accountId,
          change === "version"
            ? { grantVersion: 2 }
            : { grantedScopes: ["identify"] },
        ),
      );
    await expect(
      f.t.mutation(api.access.authorizeCollection, {
        ...f.actor,
        id: r.id,
        grantVersion: 1,
        grantedScopes: scopes,
      }),
    ).rejects.toThrow();
  }
  const f = await fixture(),
    r = await f.request(false);
  expect(
    (
      await f.t.query(api.access.preflight, {
        ...f.actor,
        id: r.id,
        now: Date.now(),
      })
    ).status,
  ).toBe("denied");
});
test("late receipts remain evidence after ending, and a later request can ask again", async () => {
  const f = await fixture(),
    r = await f.request();
  const result = await f.t.mutation(api.access.authorizeCollection, {
    ...f.actor,
    id: r.id,
    grantVersion: 1,
    grantedScopes: scopes,
  });
  await f.owner.mutation(api.access.end, { id: r.id });
  await f.t.mutation(api.access.acknowledge, {
    ...f.actor,
    id: r.id,
    receiptProof: result.receiptProof,
  });
  const row = await f.t.query(api.access.status, { ...f.actor, id: r.id });
  expect(row.status).toBe("ended");
  expect(row.receivedAt).toBeTypeOf("number");
  expect((await f.t.mutation(api.access.request, f.requestArgs)).id).not.toBe(
    r.id,
  );
  await expect(
    f.t.mutation(api.access.acknowledge, {
      ...f.actor,
      id: r.id,
      receiptProof: "wrong",
    }),
  ).rejects.toThrow();
});
test("pending pagination and exact counts go beyond fifty; account discovery goes beyond one hundred", async () => {
  const f = await fixture();
  for (let i = 0; i < 55; i++)
    await f.t.mutation(api.access.request, {
      ...f.requestArgs,
      sessionId: `session_extra${i}`,
    });
  expect(await f.owner.query(api.access.pendingCount, {})).toBe(55);
  let cursor: string | null = null,
    total = 0;
  do {
    const page = await f.owner.query(api.access.forOwner, {
      section: "pending",
      paginationOpts: { cursor, numItems: 20 },
    });
    total += page.page.length;
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  expect(total).toBe(55);
  const saved = await f.t.run((ctx) =>
    ctx.db.get("connectedAccounts", f.accountId),
  );
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 105; i++) {
      const a = omit(saved!, ["_id", "_creationTime"]);
      await ctx.db.insert("connectedAccounts", { ...a, label: `Account ${i}` });
    }
  });
  total = 0;
  do {
    const page = await f.t.query(api.accounts.listForClient, {
      ...f.actor,
      paginationOpts: { cursor, numItems: 30 },
    });
    total += page.page.length;
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  expect(total).toBe(106);
});
test("failed or expired setup retains references, and duplicate cleanup cannot revoke the real account", async () => {
  const f = await fixture(),
    setup = await f.owner.mutation(api.accounts.beginConnection, f.setup);
  const completion = await f.owner.mutation(api.accounts.completeConnection, {
    ...f.completion,
    id: setup.id,
  });
  expect(completion.active).toBe(false);
  expect(completion.issue).toBe("grant-conflict");
  const row = await f.owner.query(api.accounts.setupForOwner, {
    secret,
    id: setup.id,
  });
  expect(row.connect.installationId).toBe("I1");
  await expect(
    f.owner.mutation(api.accounts.block, {
      secret,
      id: setup.id,
      grantVersion: 1,
    }),
  ).rejects.toThrow("recovery");
  expect(
    (
      await f.owner.mutation(api.accounts.block, {
        secret,
        id: f.accountId,
        grantVersion: 1,
      })
    ).state,
  ).toBe("blocked");
  const late = await f.owner.mutation(api.accounts.beginConnection, f.setup);
  await f.t.run((ctx) =>
    ctx.db.patch("connectedAccounts", late.id, {
      setupExpiresAt: Date.now() - 1,
    }),
  );
  const result = await f.owner.mutation(api.accounts.completeConnection, {
    ...f.completion,
    id: late.id,
    providerUserId: "U2",
    installationId: "I2",
  });
  expect(result.active).toBe(false);
  expect(
    (await f.owner.query(api.accounts.setupForOwner, { secret, id: late.id }))
      .connect.installationId,
  ).toBe("I2");
});
test("disconnect completion is monotonic and hides only confirmed completion", async () => {
  const f = await fixture();
  await f.owner.mutation(api.accounts.block, {
    secret,
    id: f.accountId,
    grantVersion: 1,
  });
  await f.owner.mutation(api.accounts.recordDisconnect, {
    secret,
    id: f.accountId,
    grantVersion: 1,
    outcome: "failed",
  });
  expect(
    (
      await f.owner.query(api.accounts.forOwner, {
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page,
  ).toHaveLength(1);
  await f.owner.mutation(api.accounts.recordDisconnect, {
    secret,
    id: f.accountId,
    grantVersion: 1,
    outcome: "succeeded",
  });
  expect(
    await f.owner.mutation(api.accounts.recordDisconnect, {
      secret,
      id: f.accountId,
      grantVersion: 1,
      outcome: "failed",
    }),
  ).toBe("succeeded");
  expect(
    (
      await f.owner.query(api.accounts.forOwner, {
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page,
  ).toHaveLength(0);
});

test("a callback after provisional cleanup cannot reactivate the closed setup", async () => {
  const f = await fixture(),
    setup = await f.owner.mutation(api.accounts.beginConnection, f.setup);
  await f.owner.mutation(api.accounts.abandonWithoutGrant, {
    secret,
    id: setup.id,
  });
  const result = await f.owner.mutation(api.accounts.completeConnection, {
    ...f.completion,
    id: setup.id,
    providerUserId: "Ulate",
    installationId: "Ilate",
  });
  expect(result).toMatchObject({ active: false, issue: "setup-closed" });
  const saved = await f.owner.query(api.accounts.setupForOwner, {
    secret,
    id: setup.id,
  });
  expect(saved.visible).toBe(true);
  expect(saved.state).toBe("blocked");
  expect(saved.connect.installationId).toBe("Ilate");
});
