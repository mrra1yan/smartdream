import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { AdContainer } from "@/components/ad-container";
import { requireUser } from "@/lib/auth";
import { AutoLikeButton } from "@/components/autolike-button";
import { CacheClearButton } from "@/components/cache-clear-button";

export default async function MainLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <AppSidebar role={user.role}>
      <div className="flex flex-col gap-6">
        {children}
        <AdContainer />
      </div>
      {user.role === "user" && (
        <div className="fixed bottom-6 right-4 md:right-8 z-[60] [margin-bottom:env(safe-area-inset-bottom)]">
          <AutoLikeButton />
          <CacheClearButton />
        </div>
      )}
    </AppSidebar>
  );
}
