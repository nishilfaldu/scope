import { api } from "@/convex/_generated/api";
import { readGrant, revoke } from "@/lib/connect";
import { failureCode, ownerSession, scopeOrigin } from "@/lib/scope-server";

export async function GET(request: Request) {
  const url = new URL(request.url),
    redirect = new URL("/accounts", scopeOrigin());
  try {
    const providerId = url.searchParams.get("provider");
    if (!providerId || url.searchParams.has("error"))
      throw new Error("connection-failed");
    const { client, ownerId } = await ownerSession();
    const grant = await readGrant(ownerId, providerId);
    const { replaced } = await client.mutation(api.accounts.save, {
      providerId,
      ...grant,
    });
    if (replaced) await revoke({ ownerId, ...replaced }).catch(() => undefined);
    redirect.searchParams.set("connection", "connected");
  } catch (error) {
    redirect.searchParams.set("connection", "failed");
    redirect.searchParams.set(
      "error",
      error instanceof Error && error.message === "connection-failed"
        ? "connection-failed"
        : failureCode(error),
    );
  }
  return new Response(null, {
    status: 303,
    headers: { Location: redirect.toString(), "Cache-Control": "no-store" },
  });
}
