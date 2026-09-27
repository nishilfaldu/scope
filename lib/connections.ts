import { ALL_APPS, type AppId } from "../convex/domain/apps";

export { ALL_APPS, type AppId };
export const CONNECTION_APPS = [
  {
    id: "github",
    name: "GitHub",
    description: "GitHub repositories and account.",
  },
  { id: "gmail", name: "Gmail", description: "Read and manage mail." },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Manage calendar events.",
  },
  {
    id: "files",
    name: "Google files",
    description: "Drive, Docs, and Sheets in one connection.",
  },
  { id: "slack", name: "Slack", description: "Slack workspace access." },
  {
    id: "airtable",
    name: "Airtable",
    description: "Bases, schemas, records, and comments.",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Pages and databases shared with Scope.",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issues, projects, teams, and workflow updates.",
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Projects, deployments, domains, and team profile.",
  },
  {
    id: "zoom",
    name: "Zoom",
    description: "Meetings, webinars, and recordings.",
  },
] as const satisfies ReadonlyArray<{
  id: AppId;
  name: string;
  description: string;
}>;

const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
export const APP_CONNECT_URL = Object.fromEntries(
  ALL_APPS.map((app) => [app, `${siteUrl}/api/${app}/connect`]),
) as Record<AppId, string>;
export const CONNECT_ERRORS: Record<string, string> = {
  token: "The provider did not issue a token. Check the OAuth callback URL.",
  identity:
    "The provider could not identify the connected account. Try connecting again.",
  scope:
    "Google returned missing or unrelated service permissions. Reconnect this app; if it persists, remove Scope in Google Account and reconnect your Google apps.",
  redirect_uri_mismatch:
    "The provider rejected the callback URL. Register this app's /api/<app>/callback URL.",
  state: "Connect session expired. Try connecting again.",
  code: "The provider did not return an authorization code.",
  config: "OAuth client id/secret are missing on Convex.",
};
