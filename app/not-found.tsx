import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/shared/brand-mark";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="text-center">
        <BrandMark className="mx-auto size-11 rounded-xl" />
        <h1 className="mt-5 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be incorrect or no longer available.
        </p>
        <Button className="mt-6" render={<Link href="/agents" />}>
          Go to Agents
        </Button>
      </div>
    </main>
  );
}
