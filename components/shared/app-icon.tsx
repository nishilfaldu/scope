import {
  Chart01Icon,
  CloudIcon,
  DatabaseIcon,
  GithubIcon,
  GoogleIcon,
  Notion01Icon,
  SlackIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppId } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

export function AppIcon({
  app,
  className,
}: {
  app: AppId;
  className?: string;
}) {
  const icon = ["gmail", "calendar", "files"].includes(app)
    ? GoogleIcon
    : app === "github"
      ? GithubIcon
      : app === "slack"
        ? SlackIcon
        : app === "notion"
          ? Notion01Icon
          : app === "linear"
            ? Chart01Icon
            : app === "vercel"
              ? CloudIcon
              : DatabaseIcon;
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted",
        className,
      )}
    >
      <HugeiconsIcon icon={icon} className="size-4" strokeWidth={2} />
    </span>
  );
}
