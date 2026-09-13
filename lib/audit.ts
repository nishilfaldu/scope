import type { ActorType, AuditKind, Outcome } from "../convex/auditFields";

export const KIND_LABELS: Record<AuditKind, string> = {
  issued: "Issued",
  platform_toggled: "Platform toggled",
  revoked: "Revoked",
  expired: "Expired",
  token_issued: "Token issued",
  token_refreshed: "Token refreshed",
  token_revoked: "Token revoked",
  mint_denied: "Mint denied",
};

const LEGACY_KIND_LABELS: Record<string, string> = {
  presented: "Presented",
  verified: "Verified",
  used: "Used",
};

export const ACTOR_TYPE_LABELS: Record<ActorType, string> = {
  board: "Board",
  agent: "Agent",
  system: "System",
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  allowed: "Allowed",
  denied: "Denied",
};

export const STATUS_LABELS = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
} as const;

export function kindLabel(kind: string): string {
  if (kind in KIND_LABELS) {
    return KIND_LABELS[kind as AuditKind];
  }
  return LEGACY_KIND_LABELS[kind] ?? kind;
}

export function formatActor(actorType: ActorType, actorId: string): string {
  const typeLabel = ACTOR_TYPE_LABELS[actorType];
  if (actorId === actorType) {
    return typeLabel;
  }
  return `${typeLabel} · ${actorId}`;
}

export function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function lastEventLabel(event: {
  kind: string;
  action: string | null;
}): string {
  return kindLabel(event.kind);
}
