import type { ReactNode } from "react";

import { requireSuperAdmin } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";

export default async function SuperAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireSuperAdmin();
  return (
    <AppSidebar role={user.role}>
      {children}
    </AppSidebar>
  );
}
