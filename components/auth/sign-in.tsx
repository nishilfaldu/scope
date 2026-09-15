"use client";

import { PassportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useAuthActions } from "@convex-dev/auth/react";

import { GoogleMark } from "@/components/auth/google-mark";
import { ContentCard } from "@/components/shared/content-card";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";

export function SignIn() {
  const { signIn } = useAuthActions();
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <ContentCard
          headerBorder={false}
          headerClassName="items-center justify-items-center gap-3 text-center"
          title={
            <span className="flex flex-col items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <HugeiconsIcon
                  icon={PassportIcon}
                  strokeWidth={2}
                  className="size-5"
                />
              </span>
              Agent Passport
            </span>
          }
          description="Sign in to manage your passports"
        >
          <CardContent>
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => void signIn("google", { redirectTo: "/" })}
            >
              <GoogleMark />
              Continue with Google
            </Button>
          </CardContent>
        </ContentCard>
      </div>
    </div>
  );
}
