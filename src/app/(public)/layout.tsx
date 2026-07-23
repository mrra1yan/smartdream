import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { getCurrentUser } from "@/lib/auth";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const role = user ? user.role : "public";

  return (
    <AppSidebar role={role}>
      <div className="w-full flex-1">
        {children}
      </div>
    </AppSidebar>
  );
}
