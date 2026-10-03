import configuredBindings from "@/config/airtable-pat-bindings.json";

export type PatBinding = {
  key: string;
  label: string;
  connectorId: string;
  baseId: string;
};

// This file is imported only by the server. Entries contain metadata, never PATs.
// Registration verifies each configured connector against its expected base.
export const patBindings: readonly PatBinding[] = configuredBindings;

export function patBindingForKey(
  key: unknown,
  bindings: readonly PatBinding[] = patBindings,
): PatBinding {
  if (typeof key !== "string") throw new Error("Test binding unavailable");
  const binding = bindings.find((entry) => entry.key === key);
  if (!binding) throw new Error("Test binding unavailable");
  return binding;
}

export function requirePatAccount(
  account: { userId: string; connectorId: string; baseId?: string },
  ownerId: string,
  bindings: readonly PatBinding[] = patBindings,
) {
  if (
    account.userId !== ownerId ||
    !bindings.some(
      (binding) =>
        binding.connectorId === account.connectorId &&
        binding.baseId === account.baseId,
    )
  )
    throw new Error("Test account unavailable");
}
