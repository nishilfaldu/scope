import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { failure, json, ownerSession, sameOrigin } from "@/lib/scope-server";

// Called by the service worker for notification actions. It has only the session cookie.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { client } = await ownerSession();
    const { id, decision } = z
      .object({ id: z.string(), decision: z.enum(["approve", "deny"]) })
      .strict()
      .parse(await request.json());
    const approvalId = id as Id<"approvals">;
    if (decision === "approve")
      await client.mutation(api.approvals.approve, {
        id: approvalId,
        minutes: 30,
      });
    else await client.mutation(api.approvals.deny, { id: approvalId });
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
