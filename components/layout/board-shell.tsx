"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiChat02Icon,
  Plug01Icon,
  Notification01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { BrandMark } from "@/components/shared/brand-mark";
type HeaderCrumb = { label: string; href?: string };
import { useNow } from "@/hooks/use-now";
import styles from "@/components/scope/scope.module.css";
const navigation = [
  { label: "Requests", path: "/approvals", icon: ShieldKeyIcon },
  { label: "Connections", path: "/connections", icon: Plug01Icon },
  { label: "Agents", path: "/agents", icon: AiChat02Icon },
  { label: "Notifications", path: "/notifications", icon: Notification01Icon },
];
export function BoardShell({
  children,
}: {
  title: string;
  crumbs?: HeaderCrumb[];
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const user = useQuery(api.users.viewer);
  const now = useNow();
  const pending = useQuery(api.probe.pendingForOwner, { now });
  const accounts = useQuery(api.probe.accountsForOwner, {});
  const count =
    pending?.filter(
      (r) =>
        !r.requesterStopped &&
        accounts?.some(
          (a: { _id: string; revoked: boolean }) =>
            a._id === r.accountId && !a.revoked,
        ),
    ).length ?? 0;
  return (
    <div className={styles.review}>
      <div className={styles.workspace}>
        <aside className={styles.rail}>
          <Link href="/approvals" className={styles.brand}>
            <BrandMark className="size-7" />
            <span>Scope</span>
          </Link>
          <nav aria-label="Scope navigation" className={styles.navigation}>
            {navigation.map(({ label, path: href, icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
              >
                <HugeiconsIcon icon={icon} size={20} strokeWidth={1.7} />
                <span>{label}</span>
                {href === "/approvals" && count > 0 && (
                  <span className={styles.navCount}>{count}</span>
                )}
              </Link>
            ))}
          </nav>
          <details className={styles.accountMenu}>
            <summary>My account</summary>
            <p>{user?.email ?? "Loading account…"}</p>
            <button
              className={styles.textAction}
              onClick={() => void signOut().then(() => router.push("/signin"))}
            >
              Sign out
            </button>
          </details>
        </aside>
        <div className={styles.main}>{children}</div>
      </div>
    </div>
  );
}
