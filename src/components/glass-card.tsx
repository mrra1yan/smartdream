import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
}

export function GlassCard({ children, className }: GlassCardProps) {
  return (
    <div className="relative rounded-3xl">
      {/* Outer border gradient outline */}
      <div className="absolute -inset-[1px] rounded-3xl bg-gradient-to-br from-accent/30 via-border/20 to-purple-600/30 opacity-70 transition-opacity duration-300" />
      
      {/* Inner Card content container */}
      <div
        className={cn(
          "relative  bg-white/55 dark:bg-zinc-950/65",
          "border border-white/20 dark:border-white/5",
          "shadow-[0_20px_50px_rgba(0,0,0,0.06)] dark:shadow-[0_25px_60px_rgba(0,0,0,0.4)]",
          "p-6 sm:p-8 rounded-[23px]",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
