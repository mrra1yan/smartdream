import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, hasError, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-xl border bg-surface px-3 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 transition-colors",
        hasError
          ? "border-red-500 focus-visible:ring-red-500/30"
          : "border-border focus-visible:ring-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-xs font-medium text-muted", className)}
      {...props}
    />
  );
}
