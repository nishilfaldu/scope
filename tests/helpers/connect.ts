import { vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

export function managedFixture(args: {
  userId: Id<"users">;
  login: string;
  providerUserId: string;
}) {
  vi.stubEnv("CONNECT_BRIDGE_URL", "https://bridge.example/api/connect/bridge");
  vi.stubEnv("CONNECT_BRIDGE_SECRET", "test-bridge-secret-with-32-characters");
  const providerUserId =
    args.providerUserId.includes(":") || !args.providerUserId
      ? args.providerUserId
      : `T1:${args.providerUserId}`;
  return {
    userId: args.userId,
    login: args.login,
    providerUserId,
    grantedScopes: ["chat:write"],
    connect: {
      subjectId: `scope:${args.userId}:${providerUserId}`,
      issuer: "https://scope.convex.site",
      connectorId: "scl_test",
      installationId: "T1",
    },
  };
}
export function managedRow(
  args: Parameters<typeof managedFixture>[0] & { grantVersion?: number },
) {
  return {
    ...managedFixture(args),
    app: "slack" as const,
    backend: "vercel-connect" as const,
    grantVersion: args.grantVersion ?? 1,
  };
}
export function managedGrant(accessToken: string, providerUserId = "T1:1") {
  return {
    accessToken,
    expiresAt: Date.now() + 3600_000,
    providerUserId,
    login: "Slack user",
    connectorId: "scl_test",
    installationId: "T1",
    grantedScopes: ["chat:write"],
  };
}
