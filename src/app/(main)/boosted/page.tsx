import { requireUser } from "@/lib/auth";
import { getBoostedFeed } from "@/lib/feed";
import { getI18n } from "@/lib/i18n";
import { BoostedFeed } from "@/components/boosted-feed";
import { PageHeader } from "@/components/page-header";
import { MAX_CONCURRENT_ADS } from "@/lib/types";

export default async function BoostedPage() {
  const user = await requireUser();
  const { t } = await getI18n();
  const { links, nextOffset, offer } = await getBoostedFeed(
    user.id,
    user.boostedOfferCount,
    0,
    50,
  );

  return (
    <div className="flex flex-col gap-8 py-2 w-full">
      {/* Page Header */}
      <PageHeader
        badge={t("boosted.badge")}
        title={t("boosted.title")}
        description={t("boosted.description")}
      />

      <BoostedFeed
        initialLinks={links}
        initialOffset={nextOffset}
        initialOffer={offer}
        maxSlots={MAX_CONCURRENT_ADS}
      />
    </div>
  );
}
