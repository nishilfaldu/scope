import { api } from "@/convex/_generated/api";
import {
  config,
  json,
  ownerDb,
  safeError,
  sameOrigin,
} from "@/lib/scope-server";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const client = await ownerDb(),
      identity = await client.query(api.accounts.identity, {});
    if (!identity) throw new Error("Sign in required");
    const { external_auth_id } = z
      .object({ external_auth_id: z.string().min(1).max(300) })
      .strict()
      .parse(await request.json());
    const response = await fetch(
      "https://api.workos.com/authkit/oauth2/complete",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config("WORKOS_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          external_auth_id,
          user: { id: `scope:${identity.id}`, email: identity.email },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error("Authorization unavailable");
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("redirect_uri" in data) ||
      typeof data.redirect_uri !== "string"
    )
      throw new Error("Invalid redirect");
    const destination = new URL(data.redirect_uri);
    if (destination.origin !== new URL(config("WORKOS_ISSUER")).origin)
      throw new Error("Invalid redirect");
    return json({ url: destination.toString() });
  } catch {
    return safeError();
  }
}
