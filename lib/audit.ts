import type { ActorType, AuditKind, Outcome } from "../convex/auditFields";

export const KIND_LABELS: Record<AuditKind, string> = {
  issued: "Issued",
  presented: "Presented",
  verified: "Verified",
  used: "Used",
  revoked: "Revoked",
  expired: "Expired",
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
  kind: AuditKind;
  action: string | null;
}): string {
  if (event.action && (event.kind === "used" || event.kind === "presented")) {
    return event.action;
  }
  return KIND_LABELS[event.kind];
}
