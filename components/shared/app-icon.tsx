import { SlackIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppId } from "@/convex/domain/apps";
import { cn } from "@/lib/utils";

export function AppIcon({ className }: { app: AppId; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted",
        className,
      )}
    >
      <HugeiconsIcon icon={SlackIcon} className="size-4" strokeWidth={2} />
    </span>
  );
}
