import type { Metadata } from "next";

import { SignIn } from "@/components/auth/sign-in";

export const metadata: Metadata = {
  title: "Sign in - Agent Passport",
};

export default function SignInPage() {
  return <SignIn />;
}
