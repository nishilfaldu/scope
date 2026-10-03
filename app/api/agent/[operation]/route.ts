import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { clientActor, json, safeError } from "@/lib/scope-server";
import {
  deliverCredential,
  listAccounts,
  listCollectors,
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
    return safeError(401);
  }
  try {
    const { operation } = await params,
      raw = await request.text();
    if (Buffer.byteLength(raw) > 8192) return safeError(413);
    const body: unknown = JSON.parse(raw);
    if (operation === "accounts")
      return json({ accounts: await listAccounts(actor) });
    if (operation === "collectors")
      return json({ collectors: await listCollectors(actor) });
    if (operation === "request") {
      const args = z
        .object({
          accountId: z.string(),
          key: z.string().min(16).max(128),
          reason: z.string().trim().min(1).max(1000),
          intent: z.string().trim().min(1).max(240).optional(),
          collectorConnectionId: z.string().optional(),
        })
        .strict()
        .parse(body);
      return json(
        await requestAccess(actor, {
          ...args,
          accountId: args.accountId as Id<"connectedAccounts">,
          collectorConnectionId: args.collectorConnectionId as
            Id<"clientConnections"> | undefined,
        }),
      );
    }
    const args = z
        .object({ id: z.string(), receiptProof: z.string().optional() })
        .strict()
        .parse(body),
      id = args.id as Id<"approvalRequests">;
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
