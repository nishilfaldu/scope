export function effectiveSliceStatus(
  slice: { status: "staged" | "active" | "revoked"; expiresAt: number },
  now = Date.now(),
) {
  return slice.status === "revoked"
    ? ("revoked" as const)
    : slice.expiresAt <= now
      ? ("expired" as const)
      : slice.status;
}
