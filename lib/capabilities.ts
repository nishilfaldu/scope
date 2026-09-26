import { ALL_APPS, type AppId } from "../convex/domain/apps";

export { ALL_APPS, type AppId };

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
  drive:
    "Read and manage Drive files, including Google Docs and Sheets files, in the selected Google account.",
  docs: "Read and edit documents in the selected Google account.",
  sheets: "Read and edit spreadsheets in the selected Google account.",
  slack:
    "Read conversations and files, send messages, and manage bookmarks, pins, and reactions with the connected Slack user.",
  airtable:
    "Read and write records and schemas in bases approved during Airtable consent.",
  notion: "Read and edit pages shared with the Notion integration.",
  linear: "Read and write issues, projects, and teams in Linear.",
  vercel: "Access the Vercel account authorized by its OAuth grant.",
  zoom: "Access meetings and other data allowed by the configured Zoom app scopes.",
};

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
