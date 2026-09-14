"use client";

import { useState } from "react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { CreatedPassport } from "@/components/passports/create-passport-form";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function PassportCredentials({ passport }: { passport: CreatedPassport }) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      toast.add({ title: `${label} copied`, type: "success" });
      window.setTimeout(() => setCopiedValue(null), 1500);
    } catch {
      toast.add({
        title: `Could not copy ${label.toLowerCase()}`,
        type: "error",
      });
    }
  }

  return (
    <div className="rounded-2xl border bg-card px-4 py-3 text-sm">
      <div className="flex items-start gap-2.5">
        <HugeiconsIcon
          icon={Tick02Icon}
          strokeWidth={2}
          className="mt-0.5 size-4 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Created {passport.name}</p>
          <p className="mt-0.5 text-muted-foreground">
            Give the agent this passport token and passport secret. The passport
            secret is shown once. Never share standing account tokens.
          </p>
          <div className="mt-3 flex min-w-0 flex-col gap-2">
            {[
              { label: "Passport token", value: passport.passportToken },
              { label: "Passport secret", value: passport.passportSecret },
            ].map((credential) => (
              <div
                key={credential.label}
                className="flex min-w-0 items-center gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-xs text-muted-foreground">
                    {credential.label}
                  </p>
                  <code className="block min-w-0 truncate rounded-xl bg-muted px-3 py-2 font-mono text-xs">
                    {credential.value}
                  </code>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 self-end"
                  onClick={() => void copy(credential.label, credential.value)}
                >
                  <HugeiconsIcon
                    icon={
                      copiedValue === credential.value
                        ? Tick02Icon
                        : Copy01Icon
                    }
                    strokeWidth={2}
                    data-icon="inline-start"
                  />
                  {copiedValue === credential.value ? "Copied" : "Copy"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
