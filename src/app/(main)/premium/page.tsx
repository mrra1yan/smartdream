import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getAutoLikeStatus } from "@/lib/autolike";
import { PremiumFeatureCard } from "@/components/premium-feature-card";
import { getI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";

export default async function PremiumPage() {
  const user = await requireUser();
  const settings = await getSettings();
  const autolike = await getAutoLikeStatus();
  const { t } = await getI18n();

  return (
    <div className="flex flex-col gap-8 py-2">
      {/* Header */}
      <PageHeader
        badge={t("premium.featuresBadge")}
        title={t("premium.title")}
        description={t("premium.subtitle")}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Auto-Like Card */}
        <PremiumFeatureCard
          type="autolike"
          title={t("premium.autoLike")}
          description={t("premium.autoLikeDesc")}
          active={autolike.active}
          model={autolike.paidModel}
          remainingLikes={autolike.remainingLikes}
          remainingMinutes={autolike.remainingMinutes}
          freeMinutes={!!autolike.freeUntil}
          settings={settings}
          whatsappNumber={settings.whatsappNumber}
          userName={`${user.firstName} ${user.lastName}`}
          userPublicId={user.publicId}
        />

        {/* Boosted Card */}
        <PremiumFeatureCard
          type="boosted"
          title={t("premium.boosted")}
          description={t("premium.boostedDesc")}
          active={user.isBoosted}
          model={user.boostModel}
          remainingLikes={
            user.boostModel === "usage" && user.boostQuota
              ? Math.max(0, user.boostQuota - user.boostUsed)
              : null
          }
          expiry={
            user.boostModel === "time" && user.boostExpiry
              ? user.boostExpiry
              : null
          }
          settings={settings}
          whatsappNumber={settings.whatsappNumber}
          userName={`${user.firstName} ${user.lastName}`}
          userPublicId={user.publicId}
        />
      </div>
    </div>
  );
}
