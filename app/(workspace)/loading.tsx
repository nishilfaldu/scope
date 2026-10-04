"use client";
import { usePathname } from "next/navigation";
import {
  WorkspaceSkeleton,
  type BoardKind,
} from "@/components/layout/workspace-skeleton";
export default function Loading() {
  const path = usePathname();
  const kind: BoardKind =
    path === "/agents"
      ? "agents"
      : path === "/connections"
        ? "connections"
        : path === "/notifications"
          ? "notifications"
          : "requests";
  return (
    <WorkspaceSkeleton
      kind={kind}
      title={kind[0].toUpperCase() + kind.slice(1)}
    />
  );
}
