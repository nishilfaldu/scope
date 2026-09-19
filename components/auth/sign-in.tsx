"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SignIn({
  redirectTo = "/",
  title = "Agent Passport",
}: {
  redirectTo?: string;
  title?: string;
}) {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const destination =
    redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : "/";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated && window.location.pathname === "/signin")
      router.replace(destination);
  }, [isAuthenticated, destination, router]);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn("email-otp", { email: email.trim().toLowerCase() });
      setSent(true);
    } catch {
      setError("We could not send a code right now. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await signIn("email-otp", {
        email: email.trim().toLowerCase(),
        code: code.trim(),
      });
      if (!result.signingIn) {
        setError(
          "That code is invalid or expired. Check the email and try again.",
        );
        return;
      }
      if (window.location.pathname === "/signin") router.replace(destination);
    } catch {
      setError(
        "That code is invalid or expired. Check the email and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {sent ? (
            <p className="text-sm text-muted-foreground">
              If a code can be sent to this address, it will arrive shortly.
              Codes expire after 10 minutes.
            </p>
          ) : null}
          <form
            onSubmit={sent ? verifyCode : requestCode}
            className="space-y-3"
          >
            <label className="block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={sent}
              className="w-full rounded-md border bg-background px-3 py-2"
            />
            {sent ? (
              <>
                <label className="block text-sm font-medium" htmlFor="code">
                  Code
                </label>
                <input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{8}"
                  maxLength={8}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2"
                />
              </>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button className="w-full" disabled={busy} type="submit">
              {sent ? "Verify code" : "Email me a code"}
            </Button>
          </form>
          {sent ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setSent(false);
                setCode("");
                setError("");
              }}
            >
              Use another email
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
