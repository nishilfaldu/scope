import { providerName } from "./connectors";

// Provider scope names in plain language. Unknown scopes show their raw name.
const plain: Record<string, Record<string, string>> = {};

export function describeScope(providerId: string, scope: string) {
  return plain[providerId]?.[scope] ?? scope;
}

export function unreportedPermissions(providerId: string) {
  return `Permissions were set on ${providerName(providerId)}'s consent screen.`;
}
