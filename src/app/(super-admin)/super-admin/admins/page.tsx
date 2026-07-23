import { requireSuperAdmin } from "@/lib/auth";
import { getAdmins } from "@/lib/super-admin";
import { AdminsManager } from "@/components/super-admin/admins-manager";

export default async function AdminsPage() {
  await requireSuperAdmin();
  const admins = await getAdmins();
  return <AdminsManager admins={admins} />;
}
