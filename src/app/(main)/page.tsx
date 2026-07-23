import { requireUser } from "@/lib/auth";
import { getMyStats } from "@/lib/stats";
import { getFeed } from "@/lib/feed";
import { getI18n } from "@/lib/i18n";
import { Feed } from "@/components/feed";
import * as React from "react";
import { PageHeader } from "@/components/page-header";
import { WelcomeBanner } from "@/components/welcome-banner";
import { HomeStatsClient } from "@/components/home-stats-client";
import { MAX_CONCURRENT_ADS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  const { t } = await getI18n();
  const [stats, { links, nextOffset }] = await Promise.all([
    getMyStats(),
    getFeed(user.id, 0, 50)
  ]);

  return (
    <div className="flex flex-col gap-8 w-full py-2">
      {/* Welcome Banner */}
      <WelcomeBanner>
        <PageHeader
          badge={t("home.overview")}
          title={
            <>
              {t("home.welcome")},{" "}
              <span className="bg-gradient-to-r from-accent to-purple-600 bg-clip-text text-transparent">
                {user.firstName}
              </span>
            </>
          }
          description={t("home.subtitle")}
          gradient={false}
          className="relative z-10"
        />
      </WelcomeBanner>

      {/* Today's Overview Stat Cards (Real-time) */}
      <HomeStatsClient initialStats={stats} userId={user.id} />

      {/* Live Feed Container */}
      <section className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl">
        <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/5 blur-3xl" />
        
        <div className="mb-6 flex items-center justify-between border-b border-border/20 pb-4">
          <h2 className="text-lg font-black text-foreground flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            {t("home.liveFeed")}
          </h2>
        </div>
        
        <Feed
          endpoint="/api/feed"
          initialLinks={links}
          initialOffset={nextOffset}
          maxSlots={MAX_CONCURRENT_ADS}
        />
      </section>
    </div>
  );
}
