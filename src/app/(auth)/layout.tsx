import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AppSidebar role="public" contentClassName="!p-0">
      {/*
        h-full fills the main scroll container (which is h-dvh minus the
        mobile header). On desktop the sidebar is sticky h-dvh, so this
        div exactly matches viewport height — no overflow, no scroll.
      */}
      <div className="relative flex h-full min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-6 overflow-hidden lg:min-h-dvh">
        {/* Background Grid Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:24px_24px] opacity-100 dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)]" />
        
        {/* Multi-layered Ambient Glows */}
        <div className="pointer-events-none absolute -top-12 left-1/4 h-80 w-80 rounded-full bg-accent/25 blur-[120px] opacity-60 dark:bg-accent/15" />
        <div className="pointer-events-none absolute -bottom-12 right-1/4 h-96 w-96 rounded-full bg-purple-600/20 blur-[130px] opacity-50 dark:bg-purple-600/15" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[400px] rounded-full bg-indigo-500/10 blur-[150px] opacity-40" />

        <div className="relative z-10 w-full max-w-lg">
          {children}
        </div>
      </div>
    </AppSidebar>
  );
}
