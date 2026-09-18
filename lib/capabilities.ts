import { ALL_APPS, providerForApp, type AppId } from "../convex/domain/apps";

export { ALL_APPS, providerForApp, type AppId };

export type MintPolicy = "auto" | "approve";

export const APP_LABELS: Record<AppId, string> = {
  github: "GitHub",
  gmail: "Gmail",
  calendar: "Calendar",
  drive: "Drive",
  docs: "Docs",
  sheets: "Sheets",
  slack: "Slack",
  airtable: "Airtable",
  notion: "Notion",
  linear: "Linear",
  vercel: "Vercel",
  zoom: "Zoom",
};

export const APP_PERMISSIONS: Record<AppId, string> = {
  github:
    "Repository, workflow, and account permissions granted by the GitHub connection.",
  gmail: "Read, send, and manage mail in the selected Gmail account.",
  calendar:
    "Read and manage calendars and events in the selected Google account.",
  drive: "Read and manage Drive files in the selected Google account.",
  docs: "Read and edit documents in the selected Google account.",
  sheets: "Read and edit spreadsheets in the selected Google account.",
  slack:
    "Read conversations and files and send messages with the connected Slack user.",
  airtable:
    "Read and write records and schemas in bases approved during Airtable consent.",
  notion: "Read and edit pages shared with the Notion integration.",
  linear: "Read and write issues, projects, and teams in Linear.",
  vercel: "Access the Vercel account authorized by its OAuth grant.",
  zoom: "Access meetings and other data allowed by the configured Zoom app scopes.",
};

export const APP_HINTS: Record<AppId, string> = {
  github: "Create a short-lived GitHub token. The agent calls GitHub directly.",
  gmail: "Gmail via a connected Google account.",
  calendar: "Calendar via a connected Google account.",
  drive: "Drive via a connected Google account.",
  docs: "Docs via a connected Google account.",
  sheets: "Sheets via a connected Google account.",
  slack: "Create a short-lived Slack token. The agent calls Slack directly.",
  airtable: "Bases, schemas, records, and comments.",
  notion: "Pages and databases shared with the Notion connection.",
  linear: "Issues, projects, teams, and workflow updates.",
  vercel: "Projects, deployments, domains, and team profile.",
  zoom: "Meetings, webinars, recordings, and account profile.",
};

export const TTL_OPTIONS = [
  { label: "15 minutes", ttlMs: 15 * 60 * 1000 },
  { label: "1 hour", ttlMs: 60 * 60 * 1000 },
  { label: "8 hours", ttlMs: 8 * 60 * 60 * 1000 },
  { label: "24 hours", ttlMs: 24 * 60 * 60 * 1000 },
  { label: "7 days", ttlMs: 7 * 24 * 60 * 60 * 1000 },
] as const;

export const MINT_POLICY_LABELS: Record<MintPolicy, string> = {
  auto: "Auto",
  approve: "Approve",
};

export const MINT_POLICY_ITEMS = [
  {
    value: "auto",
    label: "Auto — mint immediately on request",
  },
  {
    value: "approve",
    label: "Approve — operator must approve on the board first",
  },
] as const;

export const STATUS_LABELS = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
} as const;

export function effectiveSliceStatus(
  slice: { status: "active" | "revoked" | "expired"; expiresAt: number },
  now: number,
) {
  return slice.status === "revoked"
    ? ("revoked" as const)
    : slice.expiresAt <= now
      ? ("expired" as const)
      : ("active" as const);
}

export function appLabel(id: string): string {
  return (ALL_APPS as readonly string[]).includes(id)
    ? APP_LABELS[id as AppId]
    : id;
}

export function formatRemaining(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60_000);
  if (minutes === 0) return "<1m left";
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 48) return `${hours}h ${remainingMinutes}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ${remainingMinutes}m left`;
}

export function formatRelativeTime(ts: number, now: number): string {
  const seconds = Math.floor((now - ts) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(ts).toLocaleString();
}
