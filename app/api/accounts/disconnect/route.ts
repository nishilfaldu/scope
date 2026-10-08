import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { revoke } from "@/lib/connect";
import { failure, json, ownerSession, sameOrigin } from "@/lib/scope-server";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { client } = await ownerSession();
    const { id } = z
      .object({ id: z.string() })
      .strict()
      .parse(await request.json());
    const account = await client.query(api.accounts.get, {
      id: id as Id<"accounts">,
    });
    await revoke(account);
    await client.mutation(api.accounts.remove, { id: account._id });
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
