import {
  ALL_APPS,
  providerForApp,
  type AppId,
} from "../convex/domain/apps";
import { CAPABILITY_LABELS, CAPABILITY_SUMMARIES } from "../convex/domain/capabilities";

export { ALL_APPS, providerForApp, type AppId };

export type MintPolicy = "auto" | "approve";

export const APP_LABELS = CAPABILITY_LABELS;
export const APP_PERMISSIONS = CAPABILITY_SUMMARIES;

export const APP_HINTS = CAPABILITY_SUMMARIES;

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
  return slice.status === "revoked" ? "revoked" as const
    : slice.expiresAt <= now ? "expired" as const : "active" as const;
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
