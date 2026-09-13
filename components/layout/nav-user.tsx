"use client";

import {
  ComputerIcon,
  Moon02Icon,
  Sun01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTheme } from "next-themes";

import { UserIdentity } from "@/components/layout/user-identity";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { UserInfo } from "@/lib/user";

const THEMES = ["light", "dark", "system"] as const;

type ThemeOption = (typeof THEMES)[number];

function isThemeOption(value: string): value is ThemeOption {
  return (THEMES as readonly string[]).includes(value);
}

export function NavUser({
  user,
}: {
  user: UserInfo;
}) {
  const { isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <UserIdentity user={user} />
            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              strokeWidth={2}
              className="ml-auto size-4"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <UserIdentity user={user} />
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                if (typeof value === "string" && isThemeOption(value)) {
                  setTheme(value);
                }
              }}
            >
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuRadioItem value="light">
                <HugeiconsIcon icon={Sun01Icon} strokeWidth={2} />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <HugeiconsIcon icon={Moon02Icon} strokeWidth={2} />
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <HugeiconsIcon icon={ComputerIcon} strokeWidth={2} />
                System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
