import type { ReactNode } from "react";

import { requireStaff } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireStaff();
  return (
    <AppSidebar role={user.role}>
      {children}
    </AppSidebar>
  );
}
