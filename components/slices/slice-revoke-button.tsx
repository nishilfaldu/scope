"use client";

import { useState } from "react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useErrorCatchingMutation } from "@/lib/errors";

export function SliceRevokeButton({
  sliceToken,
  sliceName,
}: {
  sliceToken: string;
  sliceName: string;
}) {
  const [revoke] = useErrorCatchingMutation(
    api.tables.slices.mutations.revoke,
    { successMessage: "Slice revoked" },
  );
  const [busy, setBusy] = useState(false);

  async function handleRevoke() {
    setBusy(true);
    try {
      await revoke({ sliceToken });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      disabled={busy}
      onClick={() => void handleRevoke()}
      aria-label={`Revoke ${sliceName}`}
    >
      <HugeiconsIcon
        icon={Delete02Icon}
        strokeWidth={2}
        data-icon="inline-start"
      />
      {busy ? "Revoking…" : "Revoke"}
    </Button>
  );
}
