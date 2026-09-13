"use client";

import { useState } from "react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function CopyableField({
  label,
  value,
  successMessage,
}: {
  label: string;
  value: string;
  successMessage?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(successMessage ?? `${label} copied`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex min-w-0 items-center gap-1">
        <code className="max-w-36 truncate font-mono text-xs sm:max-w-56">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void handleCopy()}
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            strokeWidth={2}
          />
          <span className="sr-only">Copy {label.toLowerCase()}</span>
        </Button>
      </div>
    </div>
  );
}
