"use client";

import { PassportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useAuthActions } from "@convex-dev/auth/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GoogleMark } from "@/components/auth/google-mark";

function safeRedirectPath(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export function SignIn({
  redirectTo = "/",
  title = "Agent Passport",
  description = "Sign in to manage your slices",
}: {
  redirectTo?: string;
  title?: string;
  description?: string;
}) {
  const { signIn } = useAuthActions();
  const destination = safeRedirectPath(redirectTo);
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center justify-items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HugeiconsIcon
              icon={PassportIcon}
              strokeWidth={2}
              className="size-5"
            />
          </div>
          <div className="flex flex-col gap-1">
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => void signIn("google", { redirectTo: destination })}
          >
            <GoogleMark />
            Continue with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
