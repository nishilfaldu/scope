"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    toast.add({
      id: "page-load",
      title: "This page could not load. Try again.",
      type: "error",
      priority: "high",
    });
  }, [error]);
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-scope-wash p-6 text-center text-scope-ink">
      <h1 className="text-[28px] leading-tight font-[550] tracking-[-1px]">
        This page could not load.
      </h1>
      <p className="mt-2 text-sm text-scope-quiet">Try again.</p>
      <Button className="mt-6" onClick={retry}>
        Try again
      </Button>
    </main>
  );
}
