import type { ReactNode } from "react";

interface WelcomeBannerProps {
  children: ReactNode;
}

export function WelcomeBanner({ children }: WelcomeBannerProps) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-accent/20 bg-gradient-to-br from-accent/15 via-purple-500/10 to-background p-6 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-6">
      <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent/15 blur-2xl pointer-events-none" />
      <div className="absolute -left-8 -bottom-8 h-28 w-28 rounded-full bg-purple-600/5 blur-2xl pointer-events-none" />
      {children}
    </div>
  );
}
