"use client";
import { usePathname } from "next/navigation";
import {
  WorkspaceSkeleton,
  type BoardKind,
} from "@/components/layout/workspace-skeleton";
export default function Loading() {
  const path = usePathname();
  const kind: BoardKind =
    path === "/connections"
      ? "connections"
      : path === "/notifications"
        ? "notifications"
        : "access";
  return (
    <WorkspaceSkeleton
      kind={kind}
      title={kind[0].toUpperCase() + kind.slice(1)}
    />
  );
}
