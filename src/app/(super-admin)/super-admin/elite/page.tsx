import { requireSuperAdmin } from "@/lib/auth";
import { getEliteUsers } from "@/lib/super-admin";
import { EliteManager } from "@/components/super-admin/elite-manager";

export default async function ElitePage() {
  await requireSuperAdmin();
  const elite = await getEliteUsers();
  return <EliteManager elite={elite} />;
}
