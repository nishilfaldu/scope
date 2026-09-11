"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ComputerIcon,
  GithubIcon,
  Moon02Icon,
  Plug01Icon,
  Sun01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTheme } from "next-themes";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
import type { ConnectionStatus } from "@/lib/connections";

const THEMES = ["light", "dark", "system"] as const;

type ThemeOption = (typeof THEMES)[number];

function isThemeOption(value: string): value is ThemeOption {
  return (THEMES as readonly string[]).includes(value);
}

export function NavUser({
  github,
}: {
  github: ConnectionStatus | undefined;
}) {
  const { isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const name =
    github === undefined
      ? "GitHub"
      : github.connected
        ? github.login
        : "GitHub";
  const status =
    github === undefined
      ? "Checking…"
      : github.connected
        ? "Connected"
        : "Not connected";

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
            <Avatar className="size-8 rounded-lg">
              {github?.connected === true ? (
                <AvatarImage
                  src={`https://github.com/${github.login}.png?size=64`}
                  alt={github.login}
                />
              ) : null}
              <AvatarFallback className="rounded-lg">
                <HugeiconsIcon icon={GithubIcon} strokeWidth={2} className="size-4" />
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs">{status}</span>
            </div>
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
                  <Avatar className="size-8 rounded-lg">
                    {github?.connected === true ? (
                      <AvatarImage
                        src={`https://github.com/${github.login}.png?size=64`}
                        alt={github.login}
                      />
                    ) : null}
                    <AvatarFallback className="rounded-lg">
                      <HugeiconsIcon
                        icon={GithubIcon}
                        strokeWidth={2}
                        className="size-4"
                      />
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{name}</span>
                    <span className="truncate text-xs">{status}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/connections" />}>
              <HugeiconsIcon icon={Plug01Icon} strokeWidth={2} />
              Connections
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={mounted ? theme : undefined}
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
