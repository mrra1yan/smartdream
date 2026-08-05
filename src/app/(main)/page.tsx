import { requireUser } from "@/lib/auth";
import { getMyStats } from "@/lib/stats";
import { getFeed } from "@/lib/feed";
import { getI18n } from "@/lib/i18n";
import { Feed } from "@/components/feed";
import * as React from "react";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { WelcomeBanner } from "@/components/welcome-banner";
import { HomeStatsClient } from "@/components/home-stats-client";
import { MAX_CONCURRENT_ADS } from "@/lib/types";

export const dynamic = "force-dynamic";

// ── Streaming data sections ──────────────────────────────────────────
// By splitting the heavy data fetches (stats & feed) into separate async
// components wrapped in <Suspense>, the page shell (welcome banner +
// header) streams to the browser immediately. Stats and feed then stream
// in as their respective DB queries resolve — the user sees content in
// ~200ms instead of waiting 1-3s for everything.

async function HomeStatsSection({ userId }: { userId: string }) {
  const stats = await getMyStats();
  return <HomeStatsClient initialStats={stats} userId={userId} />;
}

async function FeedSection({
  userId,
  heading,
}: {
  userId: string;
  heading: string;
}) {
  const { links, nextOffset } = await getFeed(userId, 0, 50);
  return (
    <section className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl">
      <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/5 blur-3xl" />

      <div className="mb-6 flex items-center justify-between border-b border-border/20 pb-4">
        <h2 className="text-lg font-black text-foreground flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          {heading}
        </h2>
      </div>

      <Feed
        endpoint="/api/feed"
        initialLinks={links}
        initialOffset={nextOffset}
        maxSlots={MAX_CONCURRENT_ADS}
      />
    </section>
  );
}

// ── Skeleton fallbacks ───────────────────────────────────────────────

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-border/30 bg-surface/60 p-5"
        >
          <div className="mb-3 h-3 w-16 rounded-full bg-muted/40" />
          <div className="h-7 w-20 rounded-md bg-muted/30" />
        </div>
      ))}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl">
      <div className="mb-6 flex items-center gap-2 border-b border-border/20 pb-4">
        <div className="h-4 w-4 animate-pulse rounded-full bg-muted/40" />
        <div className="h-5 w-24 animate-pulse rounded-md bg-muted/30" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="mb-4 animate-pulse rounded-xl border border-border/20 bg-surface/50 p-4"
        >
          <div className="mb-2 h-4 w-3/4 rounded-md bg-muted/30" />
          <div className="h-3 w-1/2 rounded-md bg-muted/20" />
        </div>
      ))}
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default async function HomePage() {
  const user = await requireUser();
  const { t } = await getI18n();

  return (
    <div className="flex flex-col gap-8 w-full py-2">
      {/* Welcome Banner — renders immediately */}
      <WelcomeBanner>
        <PageHeader
          badge="TaziMa Helping Hand"
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

      {/* Today's Overview Stat Cards — streams in */}
      <Suspense fallback={<StatsSkeleton />}>
        <HomeStatsSection userId={user.id} />
      </Suspense>

      {/* Live Feed Container — streams in */}
      <Suspense fallback={<FeedSkeleton />}>
        <FeedSection userId={user.id} heading={t("home.liveFeed")} />
      </Suspense>
    </div>
  );
}
