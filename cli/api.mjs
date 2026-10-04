import { failureMessage } from "../shared/failures.mjs";
import { accessToken } from "./oauth.mjs";
export async function scopeCall(
  operation,
  body,
  { session = accessToken, fetcher = fetch, signal } = {},
) {
  const config = await session();
  const response = await fetcher(config.origin + "/api/cli/" + operation, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(failureMessage(body.code));
  }
  return response.json();
}
