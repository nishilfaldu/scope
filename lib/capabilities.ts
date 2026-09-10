import { ALL_APPS, type AppId } from "../convex/permissions";

export { ALL_APPS, type AppId };

export const APP_LABELS: Record<AppId, string> = {
  demo: "Demo",
  github: "GitHub",
};

export const APP_HINTS: Record<AppId, string> = {
  demo: "Echo test calls. No GitHub.",
  github: "All GitHub actions this server supports.",
};

export const TTL_OPTIONS = [
  { label: "15 minutes", ttlMs: 15 * 60 * 1000 },
  { label: "1 hour", ttlMs: 60 * 60 * 1000 },
  { label: "8 hours", ttlMs: 8 * 60 * 60 * 1000 },
  { label: "24 hours", ttlMs: 24 * 60 * 60 * 1000 },
  { label: "7 days", ttlMs: 7 * 24 * 60 * 60 * 1000 },
] as const;

export function formatRemaining(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
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
