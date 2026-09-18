import { ALL_APPS, providerForApp, scopesForGoogleApp, type AppId } from "./apps";

export const SLACK_USER_SCOPES = "identify,channels:history,channels:read,chat:write,groups:read,im:history,im:read,users:read,search:read,files:read,files:write";
export const AIRTABLE_SCOPES = "data.records:read data.records:write schema.bases:read schema.bases:write user.email:read";
export const LINEAR_SCOPES = "read,write";
export const VERCEL_SCOPES = "openid email profile offline_access";

function fixedScopes(app: AppId): string[] | null {
  if (["gmail", "calendar", "drive", "docs", "sheets"].includes(app)) {
    return scopesForGoogleApp(app).split(" ");
  }
  if (app === "slack") return SLACK_USER_SCOPES.split(",");
  if (app === "airtable") return AIRTABLE_SCOPES.split(" ");
  if (app === "linear") return LINEAR_SCOPES.split(",");
  if (app === "vercel") return VERCEL_SCOPES.split(" ");
  return null;
}

export const CAPABILITY_SUMMARIES: Record<AppId, string> = {
  github: "Repositories, workflow, account, and other permissions granted by the GitHub connection.",
  gmail: "Read, send, and manage mail in the selected Gmail account.",
  calendar: "Read and manage calendars and events in the selected Google account.",
  drive: "Read and manage Drive files in the selected Google account.",
  docs: "Read and edit documents in the selected Google account.",
  sheets: "Read and edit spreadsheets in the selected Google account.",
  slack: "Read conversations and files and send messages with the connected Slack user.",
  airtable: "Read and write records and schemas in bases approved during Airtable consent.",
  notion: "Read and edit pages shared with the Notion integration.",
  linear: "Read and write issues, projects, and teams in Linear.",
  vercel: "Access the Vercel account authorized by its OAuth grant.",
  zoom: "Access meetings and other data allowed by the configured Zoom app scopes.",
};

export const CAPABILITY_LABELS: Record<AppId, string> = {
  github: "GitHub", gmail: "Gmail", calendar: "Calendar", drive: "Drive",
  docs: "Docs", sheets: "Sheets", slack: "Slack", airtable: "Airtable",
  notion: "Notion", linear: "Linear", vercel: "Vercel", zoom: "Zoom",
};

export const PUBLIC_CAPABILITIES = ALL_APPS.map((app) => ({
  app,
  label: CAPABILITY_LABELS[app],
  provider: providerForApp(app),
  permissionSummary: CAPABILITY_SUMMARIES[app],
  // OAuth scopes are an upstream limit, not operation-level authorization.
  oauthScopes: fixedScopes(app),
  scopeSource: fixedScopes(app) ? "fixed" : "provider-or-configuration",
}));
