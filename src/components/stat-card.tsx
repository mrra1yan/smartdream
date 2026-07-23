import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  className?: string;
  valueClassName?: string;
}

export function StatCard({ label, value, icon, className, valueClassName }: StatCardProps) {
  return (
    <div className={cn("group relative flex flex-col justify-between rounded-2xl border border-border/40 bg-surface/90 p-3 sm:p-5 shadow-lg  transition-all  hover:shadow-xl hover:border-accent/30 min-h-[100px] sm:min-h-[120px]", className)}>
      <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-accent/5 blur-2xl group-hover:bg-accent/15 transition-colors" />
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs sm:text-sm font-bold uppercase text-muted-foreground/80 group-hover:text-foreground/70 transition-colors leading-snug">
          {label}
        </span>
        {icon && (
          <div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/5 border border-accent/10 group-hover:bg-accent/10 transition-colors">
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 mt-3 sm:mt-4">
        <span className={cn("text-xl sm:text-3xl font-black text-foreground", valueClassName)}>
          {value}
        </span>
        {icon && (
          <div className="flex sm:hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/5 border border-accent/10 group-hover:bg-accent/10 transition-colors">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
