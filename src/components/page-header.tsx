import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  badge?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  gradient?: boolean;
  className?: string;
}

export function PageHeader({
  badge,
  title,
  description,
  gradient = true,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-3 text-center sm:text-left", className)}>
      {badge && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-0.5 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/20 leading-[2em]">
          {badge}
        </span>
      )}
      <h1
        className={cn(
          "text-2xl font-black text-foreground sm:text-3xl",
          gradient &&
            "bg-gradient-to-r from-accent via-purple-500 to-indigo-600 bg-clip-text text-transparent"
        )}
      >
        {title}
      </h1>
      {description && (
        <p className="text-xs sm:text-sm text-muted-foreground/90">
          {description}
        </p>
      )}
    </div>
  );
}
