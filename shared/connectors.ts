// Server-owned allowlist. Clients name a provider, never a Connect target.
export type Connector = {
  providerId: string;
  provider: string;
  connectorEnv: string;
  scopes?: readonly string[];
};

export const connectors: readonly Connector[] = [
  {
    providerId: "slack",
    provider: "Slack",
    connectorEnv: "SCOPE_SLACK_CONNECTOR",
    // User token scopes for Slack's MCP server. It lists only tools these allow.
    scopes: [
      "search:read.public",
      "search:read.private",
      "search:read.im",
      "search:read.mpim",
      "search:read.users",
      "channels:history",
      "groups:history",
      "im:history",
      "mpim:history",
      "channels:read",
      "groups:read",
      "im:read",
      "mpim:read",
      "users:read",
      "users:read.email",
      "chat:write",
      "reactions:read",
      "reactions:write",
      "canvases:read",
      "canvases:write",
    ],
  },
  {
    providerId: "github",
    provider: "GitHub",
    connectorEnv: "SCOPE_GITHUB_CONNECTOR",
  },
  {
    providerId: "google",
    provider: "Google",
    connectorEnv: "SCOPE_GOOGLE_CONNECTOR",
    // Google rejects an authorize URL with no scope.
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
    ],
  },
  {
    providerId: "notion",
    provider: "Notion",
    connectorEnv: "SCOPE_NOTION_CONNECTOR",
  },
  {
    providerId: "vercel",
    provider: "Vercel",
    connectorEnv: "SCOPE_VERCEL_CONNECTOR",
  },
];

export function connectorFor(providerId: string) {
  return connectors.find((entry) => entry.providerId === providerId);
}

export function providerName(providerId: string) {
  return connectorFor(providerId)?.provider ?? providerId;
}
