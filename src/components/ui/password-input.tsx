"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function PasswordInput({ className, hasError, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative w-full">
      <input
        className={cn(
          "flex h-[50px] w-full rounded-xl border bg-surface/90 dark:bg-zinc-950/30 px-3 pr-11 text-sm text-foreground placeholder:text-muted-foreground/35 focus:outline-none focus:ring-4 transition-all",
          hasError
            ? "border-red-500 focus:ring-red-500/15 focus:border-red-500"
            : "border-border/40 focus:ring-accent/15 focus:border-accent focus:bg-surface/70 dark:focus:bg-zinc-950/70",
          className,
        )}
        type={show ? "text" : "password"}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-accent transition-colors z-20"
        tabIndex={-1}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

