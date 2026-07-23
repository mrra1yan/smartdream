import { requireStaff } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/admin/settings-form";

import { updateSettings } from "@/app/actions/settings";

export default async function AdminSettingsPage() {
  await requireStaff();
  const settings = await getSettings();
  return <SettingsForm initial={settings} action={updateSettings} />;
}
