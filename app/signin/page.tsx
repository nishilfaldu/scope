import type { Metadata } from "next";

import { SignIn } from "@/components/auth/sign-in";

export const metadata: Metadata = {
  title: "Sign in · Scope",
};

function safeRedirectPath(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/";
  }
  return raw;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const redirectTo = safeRedirectPath(params.redirectTo);
  const returningToApproval = redirectTo.startsWith("/approvals");
  return (
    <SignIn
      redirectTo={redirectTo}
      title={returningToApproval ? "Continue to approve" : "Scope"}
    />
  );
}
