import { z } from "zod";
import { validCommand } from "@/shared/contracts.mjs";
import type { CommandContext } from "@/lib/approval-service";
import type { Id } from "@/convex/_generated/dataModel";
import { clientActor, json, safeError } from "@/lib/scope-server";
import {
  deliverCredential,
  listAccounts,
  recordReceipt,
  requestAccess,
  requestStatus,
  cancelRequest,
} from "@/lib/approval-service";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  let actor;
  try {
    actor = await clientActor(request);
  } catch {
    return safeError(401);
  }
  try {
    const { operation } = await params,
      raw = await request.text();
    if (Buffer.byteLength(raw) > 32768) return safeError(413);
    const body: unknown = JSON.parse(raw);
    if (operation === "accounts")
      return json({ accounts: await listAccounts(actor) });
    if (operation === "request") {
      const args = z
        .object({
          accountId: z.string(),
          key: z.string().min(16).max(128),
          reason: z.string().trim().min(1).max(1000),
          command: z.custom<CommandContext>(validCommand),
        })
        .strict()
        .parse(body);
      return json(
        await requestAccess(actor, {
          ...args,
          accountId: args.accountId as Id<"connectedAccounts">,
        }),
      );
    }
    const args = z
        .object({ id: z.string(), receiptProof: z.string().optional() })
        .strict()
        .parse(body),
      id = args.id as Id<"approvalRequests">;
    if (operation === "cancel") {
      await cancelRequest(actor, id);
      return json({ cancelled: true });
    }
    if (operation === "status") return json(await requestStatus(actor, id));
    if (operation === "deliver")
      return json(await deliverCredential(actor, id));
    if (operation === "receipt" && args.receiptProof) {
      await recordReceipt(actor, id, args.receiptProof);
      return json({ received: true });
    }
    return new Response(null, { status: 404 });
  } catch {
    return safeError();
  }
}
