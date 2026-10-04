import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { clientActor, json, safeError, safeFailure } from "@/lib/scope-server";
import {
  deliverCredential,
  listAccounts,
  recordReceipt,
  requestAccess,
  requestStatus,
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
    return safeError(401, "authority-invalid");
  }
  try {
    const { operation } = await params,
      raw = await request.text();
    if (Buffer.byteLength(raw) > 32768) return safeError(413, "invalid-input");
    const body: unknown = JSON.parse(raw);
    if (operation === "accounts") {
      const { cursor } = z
        .object({ cursor: z.string().nullable().optional() })
        .strict()
        .parse(body);
      return json(await listAccounts(actor, cursor ?? null));
    }
    if (operation === "request") {
      const args = z
        .object({
          accountId: z.string(),
          agentName: z.string().trim().min(1).max(100),
          reason: z.string().trim().min(1).max(1000),
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
      id = args.id as Id<"accessApprovals">;
    if (operation === "status") return json(await requestStatus(actor, id));
    if (operation === "deliver")
      return json(await deliverCredential(actor, id));
    if (operation === "receipt" && args.receiptProof) {
      await recordReceipt(actor, id, args.receiptProof);
      return json({ received: true });
    }
    return new Response(null, { status: 404 });
  } catch (error) {
    return safeFailure(error);
  }
}
