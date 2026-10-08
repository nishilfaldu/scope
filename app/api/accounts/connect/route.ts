import { z } from "zod";
import { authorizationUrl } from "@/lib/connect";
import {
  failure,
  json,
  ownerSession,
  sameOrigin,
  scopeOrigin,
} from "@/lib/scope-server";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { ownerId } = await ownerSession();
    const { providerId } = z
      .object({ providerId: z.string().min(1).max(64) })
      .strict()
      .parse(await request.json());
    const callback = new URL("/api/accounts/callback", scopeOrigin());
    callback.searchParams.set("provider", providerId);
    return json({
      url: await authorizationUrl(ownerId, providerId, callback.toString()),
    });
  } catch (error) {
    return failure(error);
  }
}
