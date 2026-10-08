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
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Button onClick={retry}>Try again</Button>
    </main>
  );
}
