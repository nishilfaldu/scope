import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Key01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { PublicFooter } from "@/components/public/public-footer";
import { PublicHeader } from "@/components/public/public-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Scope · Approve agent access to your accounts",
  description:
    "Scope lets you review agent requests for access to connected accounts.",
};

const controls = [
  {
    icon: ShieldKeyIcon,
    title: "Approval before access",
    body: "Review the account and purpose, then choose an approval window.",
  },
  {
    icon: Clock01Icon,
    title: "A timed approval window",
    body: "Allow token requests without asking again for 15 minutes, 30 minutes or 1 hour. End approval at any time.",
  },
  {
    icon: Key01Icon,
    title: "Credentials stay out of the browser",
    body: "The CLI gives credentials to your program privately.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-svh bg-[#f7f9f5] text-[#172019] dark:bg-background dark:text-foreground">
      <PublicHeader />
      <main>
        <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-20 lg:pb-28 lg:pt-28">
          <div className="max-w-2xl">
            <Badge
              variant="outline"
              className="mb-6 border-[#cbd6c6] bg-white/70 text-[#415042] dark:bg-card"
            >
              Scope
            </Badge>
            <h1 className="max-w-[13ch] text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
              Let agents ask. You decide what they can reach.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[#526054] dark:text-muted-foreground">
              Choose how long a verified CLI session can request tokens for a
              connected account.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                nativeButton={false}
                render={<Link href="/signin?redirectTo=/access" />}
              >
                Sign in to Scope
                <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href="/privacy" />}
              >
                Read our privacy policy
              </Button>
            </div>
          </div>

          <div className="relative lg:pl-4">
            <div className="relative overflow-hidden rounded-[1.5rem] border border-[#d8e1d4] bg-white dark:border-border dark:bg-card">
              <div className="flex items-center justify-between border-b border-[#e4eae1] px-6 py-5 dark:border-border">
                <div>
                  <p className="text-sm font-semibold">Research assistant</p>
                  <p className="mt-0.5 text-xs text-[#68746a] dark:text-muted-foreground">
                    Example request
                  </p>
                </div>
                <span className="size-2.5 rounded-full bg-primary" />
              </div>
              <div className="px-6 py-6 sm:px-8">
                <p className="text-sm text-[#68746a] dark:text-muted-foreground">
                  Requested account
                </p>
                <div className="mt-3 flex items-center justify-between rounded-xl bg-[#f3f6f1] px-4 py-4 dark:bg-muted">
                  <div>
                    <p className="font-medium">Slack</p>
                    <p className="mt-0.5 text-sm text-[#68746a] dark:text-muted-foreground">
                      Research workspace
                    </p>
                  </div>
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    className="size-5 text-primary"
                    strokeWidth={2}
                  />
                </div>
                <div className="mt-6 grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 text-sm">
                  <span className="text-[#68746a] dark:text-muted-foreground">
                    Purpose
                  </span>
                  <span>Summarize workspace channels</span>
                  <span className="text-[#68746a] dark:text-muted-foreground">
                    Allow token requests for
                  </span>
                  <span>30 minutes</span>
                </div>
                <div className="mt-7 flex gap-3 border-t border-[#e4eae1] pt-6 dark:border-border">
                  <span className="flex h-10 flex-1 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground">
                    Approve
                  </span>
                  <span className="flex h-10 flex-1 items-center justify-center rounded-full border bg-background px-4 text-sm font-medium">
                    Deny
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <p className="mx-auto max-w-6xl px-5 pb-10 text-sm leading-6 text-muted-foreground sm:px-8">
          Every token includes all permissions granted when you connected the
          account. The stated purpose does not restrict the token. Vercel
          Connect manages credentials; Scope does not inspect each token&apos;s
          permissions.
        </p>
        <section className="border-y border-[#dde5da] bg-white dark:border-border dark:bg-card">
          <div className="mx-auto grid max-w-6xl px-5 sm:px-8 lg:grid-cols-3">
            {controls.map((control, index) => (
              <article
                key={control.title}
                className={`py-9 lg:px-8 lg:py-12 ${index > 0 ? "border-t border-[#dde5da] lg:border-l lg:border-t-0 dark:border-border" : "lg:pl-0"}`}
              >
                <HugeiconsIcon
                  icon={control.icon}
                  className="size-5 text-primary"
                  strokeWidth={1.8}
                />
                <h2 className="mt-5 font-semibold">{control.title}</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-[#5d695f] dark:text-muted-foreground">
                  {control.body}
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
