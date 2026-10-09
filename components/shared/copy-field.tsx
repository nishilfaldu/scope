"use client";

import { useRef, useState } from "react";

export function CopyField({ label, value }: { label: string; value: string }) {
  const field = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "selected">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      if (field.current)
        window.getSelection()?.selectAllChildren(field.current);
      setStatus("selected");
      setTimeout(() => setStatus("idle"), 6000);
    }
  }

  return (
    <div>
      <p className="font-medium">{label}</p>
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-scope-line bg-scope-wash py-1.5 pr-1.5 pl-4">
        <code
          ref={field}
          className="min-w-0 flex-1 truncate font-mono text-[13px]"
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="h-8 shrink-0 rounded-lg bg-scope-green px-3 text-xs font-medium text-white hover:bg-scope-green-dark focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {status === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <p
        className={status === "selected" ? "mt-2 text-scope-quiet" : "sr-only"}
        aria-live="polite"
      >
        {status === "copied" && `${label} copied`}
        {status === "selected" &&
          "Your browser blocked copying. The URL is selected, so press Command+C or Ctrl+C."}
      </p>
    </div>
  );
}
