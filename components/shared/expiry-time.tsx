"use client";

import { formatRemaining } from "@/lib/capabilities";

export function ExpiryTime({ expiresAt, now, stacked = false }: {
  expiresAt: number;
  now: number;
  stacked?: boolean;
}) {
  const date = new Date(expiresAt);
  const exact = date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });

  return <span className={stacked ? "flex flex-col gap-0.5" : "inline-flex flex-wrap items-baseline gap-x-1.5"}>
    <span>{formatRemaining(expiresAt, now)}</span>
    <time dateTime={date.toISOString()} suppressHydrationWarning className="text-xs text-muted-foreground">{exact}</time>
  </span>;
}
