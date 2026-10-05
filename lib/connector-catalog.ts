// Server-owned allowlist. Clients select a product key, never a Connect target.
type ConnectorEntry = {
  providerId: string;
  provider: string;
  connectorEnv: string;
  service: string;
  scopeField?: string;
  excludedScopeField?: string;
};
export const connectorCatalog: readonly ConnectorEntry[] = [
  {
    providerId: "slack",
    provider: "Slack",
    connectorEnv: "SCOPE_SLACK_CONNECTOR",
    service: "slack",
    scopeField: "userScopes",
    excludedScopeField: "botScopes",
  },
];

export type ConnectorView = {
  providerId: string;
  provider: string;
  available: boolean;
};
