import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { tokenFor } from "@/lib/connect";
import { db, failure, json, scopeOrigin } from "@/lib/scope-server";

const approval = z.object({ id: z.string().min(1).max(64) }).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  try {
    const token =
      request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? "";
    const { operation } = await params,
      body: unknown = await request.json(),
      client = db();
    if (operation === "whoami")
      return json(await client.query(api.agents.whoami, { token }));
    if (operation === "request") {
      const args = z
        .object({
          providerId: z.string().min(1).max(64),
          reason: z.string().trim().min(1).max(1000),
        })
        .strict()
        .parse(body);
      const result = await client.mutation(api.approvals.request, {
        token,
        ...args,
      });
      return json({
        ...result,
        approvalUrl: `${scopeOrigin()}/requests?request=${result.id}`,
      });
    }
    if (operation === "status") {
      const { id } = approval.parse(body);
      return json(
        await client.query(api.approvals.status, {
          token,
          id: id as Id<"approvals">,
        }),
      );
    }
    if (operation === "token") {
      const { id } = approval.parse(body);
      const claim = await client.mutation(api.approvals.claim, {
        token,
        id: id as Id<"approvals">,
      });
      return json({
        accessToken: await tokenFor(claim),
        expiresAt: claim.expiresAt,
      });
    }
    return new Response(null, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}
