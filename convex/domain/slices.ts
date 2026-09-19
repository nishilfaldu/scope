export function effectiveSliceStatus(
  slice: { status: "active" | "revoked"; expiresAt: number },
  now = Date.now(),
) {
  return slice.status === "revoked"
    ? ("revoked" as const)
    : slice.expiresAt <= now
      ? ("expired" as const)
      : ("active" as const);
}
