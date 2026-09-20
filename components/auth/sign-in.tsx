"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthorizationShell } from "@/components/shared/authorization-shell";
import { BrandMark } from "@/components/shared/brand-mark";

export function SignIn({
  redirectTo = "/",
  title = "Scope",
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
    <AuthorizationShell showBrand={false}>
      <div className="px-6 py-7 sm:px-8 sm:py-8">
        <div className="mb-7 flex items-start gap-4">
          <BrandMark priority className="size-11 shrink-0 rounded-xl" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {sent
                ? `Enter the code sent to ${email}.`
                : "Use your email to continue."}
            </p>
          </div>
        </div>
        <div className="space-y-5">
          <form
            onSubmit={sent ? verifyCode : requestCode}
            className="space-y-4"
          >
            {!sent ? (
              <div className="space-y-2">
                <label className="block text-sm font-medium" htmlFor="email">
                  Email address
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            ) : null}
            {sent ? (
              <div className="space-y-2">
                <label className="block text-sm font-medium" htmlFor="code">
                  Verification code
                </label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="000000"
                  className="h-12 text-center font-mono text-lg tracking-[0.35em]"
                />
                <p className="text-xs text-muted-foreground">
                  Expires in 10 minutes.
                </p>
              </div>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button className="h-11 w-full" disabled={busy} type="submit">
              {busy ? "Working…" : sent ? "Continue" : "Continue with email"}
            </Button>
          </form>
          {sent ? (
            <Button
              variant="ghost"
              className="w-full"
              disabled={busy}
              onClick={() => {
                setSent(false);
                setCode("");
                setError("");
              }}
            >
              Change email address
            </Button>
          ) : null}
        </div>
      </div>
    </AuthorizationShell>
  );
}
