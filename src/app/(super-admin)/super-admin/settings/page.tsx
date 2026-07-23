import { requireSuperAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { EliteWeightForm } from "@/components/super-admin/elite-weight-form";
import { LevelReferralSettingsForm } from "@/components/super-admin/level-referral-settings-form";
import { getI18n } from "@/lib/i18n";

export default async function SuperAdminSettingsPage() {
  await requireSuperAdmin();
  const { t } = await getI18n();
  const settings = await getSettings();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("nav.settings")}</h1>
      <EliteWeightForm />
      <LevelReferralSettingsForm current={settings} />
    </div>
  );
}
