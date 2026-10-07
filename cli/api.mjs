import { failureMessage } from "../shared/failures.mjs";
import { loadConfig } from "./config.mjs";

export async function scopeCall(
  operation,
  body,
  { config, fetcher = fetch, signal } = {},
) {
  const { origin, token } = config ?? (await loadConfig());
  const response = await fetcher(`${origin}/api/agent/${operation}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(signal ? [signal] : []),
    ]),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(failureMessage(result.code));
  return result;
}
