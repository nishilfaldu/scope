"use client";

import type { ComponentProps, ReactNode } from "react";
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type HugeIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

export type ActionsMenuItem = {
  id: string;
  label: ReactNode;
  icon?: HugeIcon;
  onSelect?: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
  separatorBefore?: boolean;
};

/**
 * Reusable row/actions menu in the same spirit as ContentCard and BaseModal.
 * Declarative items keep call sites thin and consistent.
 */
export function ActionsMenu({
  items,
  align = "end",
  triggerLabel = "Open menu",
}: {
  items: readonly ActionsMenuItem[];
  align?: "start" | "center" | "end";
  triggerLabel?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" />}
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
        <span className="sr-only">{triggerLabel}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {items.map((item) => (
          <span key={item.id} className="contents">
            {item.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={item.variant}
              disabled={item.disabled}
              onClick={item.onSelect}
            >
              {item.icon ? (
                <HugeiconsIcon icon={item.icon} strokeWidth={2} />
              ) : null}
              {item.label}
            </DropdownMenuItem>
          </span>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
