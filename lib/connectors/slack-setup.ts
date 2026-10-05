import type { ConnectTokenResponse } from "@vercel/connect";
import { canonicalScopes } from "@/shared/contracts.mjs";
import { ProviderFailure } from "../connect-error";

// Used only during setup/recovery to identify duplicate grants and record permissions.
export async function inspectSlackSetup(grant: ConnectTokenResponse) {
  if (!(
    grant.token.startsWith("xoxp-") || grant.token.startsWith("xoxe.xoxp-")
  ))
    throw new ProviderFailure("grant-rejected");
  const response = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${grant.token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429 || response.status >= 500)
    throw new ProviderFailure("retryable-unavailable");
  if (!response.ok) throw new ProviderFailure("grant-rejected");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ProviderFailure("grant-rejected");
  const account = body as Record<string, unknown>;
  if (
    account.ok === false &&
    ["invalid_auth", "token_revoked"].includes(String(account.error))
  )
    throw new ProviderFailure("reauthorization-required");
  if (
    account.ok !== true ||
    account.bot_id ||
    typeof account.user_id !== "string" ||
    !account.user_id ||
    typeof account.team_id !== "string" ||
    !account.team_id ||
    (grant.externalSubject && grant.externalSubject !== account.user_id) ||
    (grant.tenantId && grant.tenantId !== account.team_id)
  )
    throw new ProviderFailure("grant-rejected");
  let grantedScopes: string[];
  try {
    grantedScopes = canonicalScopes(
      (response.headers.get("x-oauth-scopes") ?? "")
        .split(/[,\s]+/)
        .filter(Boolean),
    );
  } catch {
    throw new ProviderFailure("grant-rejected");
  }
  return {
    providerUserId: account.user_id,
    providerTenantId: account.team_id,
    label: `${typeof account.user === "string" ? account.user : account.user_id} (${typeof account.team === "string" ? account.team : account.team_id})`,
    grantedScopes,
  };
}
