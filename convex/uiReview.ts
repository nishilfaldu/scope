import { internalMutation, env } from "./_generated/server";
import { v } from "convex/values";
import { counts } from "./access";
import { internal } from "./_generated/api";
export const seed = internalMutation({
  args: { ownerId: v.string() },
  returns: v.number(),
  handler: async (ctx, { ownerId }) => {
    if (env.CONVEX_CLOUD_URL !== "https://bright-dinosaur-692.convex.cloud")
      throw new Error("Personal dev only");
    if (!/^user_[A-Za-z0-9]+$/.test(ownerId)) throw new Error("Invalid owner");
    const legacy = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_ownerId_and_visible_and_state", (q) =>
        q.eq("ownerId", ownerId).eq("visible", true),
      )
      .take(201);
    if (legacy.length === 201)
      throw new Error("Too many rows for bounded fixture cleanup");
    for (const row of legacy)
      if (
        row.connect.issuer === "https://scope-ui-demo.invalid" &&
        row.connect.subjectId.startsWith("scope-ui-review-v1:")
      )
        await ctx.db.patch("connectedAccounts", row._id, { visible: false });
    const previous = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_authorizationKey_and_provisional_and_visible", (q) =>
        q
          .eq("authorizationKey", "demo:" + ownerId)
          .eq("provisional", false)
          .eq("visible", true),
      )
      .first();
    if (previous) {
      for (const section of ["pending", "active", "history"] as const) {
        const rows = await ctx.db
          .query("accessApprovals")
          .withIndex("by_accountId_and_section", (q) =>
            q.eq("accountId", previous._id).eq("section", section),
          )
          .take(101);
        if (rows.length === 101) throw new Error("Unexpected demo rows");
        for (const row of rows)
          if (row.clientId === "demo") {
            await counts.delete(ctx, row);
            await ctx.db.delete("accessApprovals", row._id);
          }
      }
    }
    const accountId =
      previous?._id ??
      (await ctx.db.insert("connectedAccounts", {
        ownerId,
        visible: true,
        provisional: false,
        providerId: "slack",
        providerName: "Slack",
        label: "Demo · Design workspace",
        accessDescription: "channels:read",
        providerUserId: "demo-user",
        providerTenantId: "demo-team",
        authorizationKey: "demo:" + ownerId,
        connect: {
          connectorId: "demo",
          subjectId: "demo:" + ownerId,
          issuer: "https://scope-ui-demo.invalid",
          installationId: "demo",
        },
        grantVersion: 1,
        grantedScopes: ["channels:read", "identify"],
        state: "active",
      }));
    let number = 0;
    for (const status of [
      "pending",
      "active",
      "denied",
      "ended",
      "expired",
    ] as const) {
      for (
        let i = 0;
        i < (status === "pending" || status === "active" ? 3 : 12);
        i++
      ) {
        const now = Date.now(),
          section =
            status === "pending"
              ? "pending"
              : status === "active"
                ? "active"
                : "history",
          waitingUntil = now + 30 * 60_000,
          until = now + 30 * 60_000;
        const id = await ctx.db.insert("accessApprovals", {
          ownerId,
          issuer: `https://api.workos.com/user_management/${env.WORKOS_CLIENT_ID}`,
          clientId: "demo",
          sessionId: `session_demo${status}${i}`,
          accountId,
          grantVersion: 1,
          providerId: "slack",
          snapshot: {
            accountLabel: "Demo · Design workspace",
            providerName: "Slack",
            agentName:
              i === 0
                ? "Demo · Design assistant"
                : "Demo · Research assistant " + i,
            grantedScopes: ["channels:read", "identify"],
          },
          reason:
            i === 0
              ? "Prepare the weekly design handoff from public channels."
              : i === 2
                ? "Compare the public design and customer feedback channels, identify unanswered questions, and prepare a handoff for the engineering and customer success teams. Include the project channel names so I can review the summary."
                : "Review workspace channel names for the project summary.",
          status,
          section,
          waitingUntil,
          collectionCount: status === "active" ? i : 0,
          ...(status !== "pending" && status !== "denied"
            ? {
                approvedAt: now,
                until: status === "active" ? until : now,
              }
            : {}),
          ...(status === "denied" ? { deniedAt: now } : {}),
          ...(status === "ended" || status === "expired"
            ? {
                endedAt: now,
                endReason: status === "ended" ? "owner" : "expired",
              }
            : {}),
          ...(status === "active" && i
            ? {
                firstCollectedAt: now,
                lastCollectedAt: now,
                receivedAt: now,
              }
            : {}),
          ...(status === "active" ? { receiptProof: "demo-receipt" } : {}),
        });
        await counts.insert(ctx, (await ctx.db.get("accessApprovals", id))!);
        if (section !== "history")
          await ctx.scheduler.runAt(
            section === "pending" ? waitingUntil : until,
            internal.access.expire,
            {
              id,
              phase: section,
              deadline: section === "pending" ? waitingUntil : until,
            },
          );
        number++;
      }
    }
    return number;
  },
});
