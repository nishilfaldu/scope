import type { AppId } from "../domain/apps";

export function redirectTo(
  returnTo: string,
  provider: AppId,
  status: string,
  reason?: string,
): Response {
  const url = new URL(returnTo);
  url.searchParams.set(provider, status);
  if (reason) {
    url.searchParams.set("reason", reason);
  }
  return Response.redirect(url.toString(), 302);
}
