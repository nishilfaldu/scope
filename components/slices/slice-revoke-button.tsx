"use client";

import { useState } from "react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  const [open, setOpen] = useState(false);

  async function handleRevoke() {
    setBusy(true);
    try {
      await revoke({ sliceToken });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button type="button" variant="destructive" size="sm" />}
      >
        <HugeiconsIcon
          icon={Delete02Icon}
          strokeWidth={2}
          data-icon="inline-start"
        />
        Revoke
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke {sliceName}?</DialogTitle>
          <DialogDescription>
            The agent will no longer be able to request tokens through this
            grant.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>
            Cancel
          </DialogClose>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void handleRevoke()}
          >
            {busy ? "Revoking…" : "Revoke grant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
