import { notFound } from "next/navigation";
import { ScopeDesignReview } from "@/components/design-review/scope-design-review";

export const metadata = {
  title: "Scope design review",
  robots: { index: false, follow: false },
};

export default function DesignReviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <ScopeDesignReview />;
}
