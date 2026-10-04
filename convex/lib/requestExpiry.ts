import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";

// Used by creation and the legacy-data migration; repeated calls are harmless.
export async function initializeRequestExpiry(
  ctx: MutationCtx,
  row: Doc<"approvalRequests">,
): Promise<void> {
  if (
    row.expiredAt !== undefined ||
    row.expiryJobId !== undefined ||
    row.receivedAt !== undefined ||
    (row.status !== "pending" && row.status !== "approved")
  )
    return;
  if (row.approvalExpiresAt <= Date.now()) {
    await ctx.db.patch("approvalRequests", row._id, {
      expiredAt: row.approvalExpiresAt,
    });
    return;
  }
  const expiryJobId = await ctx.scheduler.runAt(
    row.approvalExpiresAt,
    internal.approvals.expire,
    {
      id: row._id,
      deadline: row.approvalExpiresAt,
    },
  );
  await ctx.db.patch("approvalRequests", row._id, { expiryJobId });
}
