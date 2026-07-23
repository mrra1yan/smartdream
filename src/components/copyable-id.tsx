"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-2 text-lg font-bold"
    >
      <span className="font-mono">{id}</span>
      {copied ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className={cn("h-4 w-4 text-muted")} />
      )}
    </button>
  );
}
