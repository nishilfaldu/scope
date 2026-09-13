"use client";

import { useState } from "react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { CreatedPassport } from "@/components/passports/create-passport-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function PassportCredentials({ passport }: { passport: CreatedPassport }) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue(null), 1500);
  }

  return (
    <Alert>
      <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
      <AlertTitle>Created {passport.name}</AlertTitle>
      <AlertDescription>
        Give the agent this passport id and invoke key. The invoke key is shown
        once. Never share standing account tokens.
      </AlertDescription>
      <div className="col-start-2 mt-3 flex min-w-0 flex-col gap-2">
        {[
          { label: "Id", value: passport.passportId },
          { label: "Key", value: passport.invokeKey },
        ].map((credential) => (
          <div key={credential.label} className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-muted px-3 py-2 font-mono text-xs">
              {credential.value}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copy(credential.value)}
            >
              <HugeiconsIcon
                icon={copiedValue === credential.value ? Tick02Icon : Copy01Icon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              {copiedValue === credential.value ? "Copied" : credential.label}
            </Button>
          </div>
        ))}
      </div>
    </Alert>
  );
}
