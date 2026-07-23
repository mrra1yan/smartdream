import { getI18n } from "@/lib/i18n";
import { getSuperCounts, getEliteUsersWithLikes } from "@/lib/super-admin";
import { Card } from "@/components/ui/card";
import { Shield, UserCog, Users, Heart, Award } from "lucide-react";

export default async function SuperAdminPage() {
  const { t } = await getI18n();
  const counts = await getSuperCounts();
  const dbEliteUsers = await getEliteUsersWithLikes();

  const eliteUsers = dbEliteUsers;

  // Colors for donut chart and list markers
  const segmentColors = [
    "stroke-indigo-500 bg-indigo-500",
    "stroke-cyan-500 bg-cyan-500",
    "stroke-purple-500 bg-purple-500",
    "stroke-rose-500 bg-rose-500",
    "stroke-amber-500 bg-amber-500",
  ];

  const textColors = [
    "text-indigo-500",
    "text-cyan-500",
    "text-purple-500",
    "text-rose-500",
    "text-amber-500",
  ];

  // Donut chart logic
  const totalLikes = eliteUsers.reduce((sum, u) => sum + u.likesReceived, 0);
  const radius = 50;
  const circumference = 2 * Math.PI * radius; // ~314.16
  let accumulatedPercent = 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("nav.superAdmin")}</h1>

      {/* Top Stats Cards (Restored counts) */}
      <section className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <Card className="flex flex-col gap-1 p-3 sm:p-4 bg-surface/50 border border-accent/20 rounded-2xl shadow-sm relative overflow-hidden">
          <div className="absolute right-2 top-2 sm:right-3 sm:top-3 text-accent/10">
            <Shield className="h-8 w-8 sm:h-12 w-12" />
          </div>
          <span className="text-2xl sm:text-3xl font-black text-accent">{counts.elite}</span>
          <span className="text-xs sm:text-sm font-semibold uppercase text-muted-foreground">{t("nav.elite")}</span>
        </Card>
        
        <Card className="flex flex-col gap-1 p-3 sm:p-4 bg-surface/50 border border-border/50 rounded-2xl shadow-sm relative overflow-hidden">
          <div className="absolute right-2 top-2 sm:right-3 sm:top-3 text-muted/10">
            <UserCog className="h-8 w-8 sm:h-12 w-12" />
          </div>
          <span className="text-2xl sm:text-3xl font-black text-foreground">{counts.admins}</span>
          <span className="text-xs sm:text-sm font-semibold uppercase text-muted-foreground">{t("nav.admins")}</span>
        </Card>

        <Card className="flex flex-col gap-1 p-3 sm:p-4 bg-surface/50 border border-border/50 rounded-2xl shadow-sm relative overflow-hidden">
          <div className="absolute right-2 top-2 sm:right-3 sm:top-3 text-muted/10">
            <Users className="h-8 w-8 sm:h-12 w-12" />
          </div>
          <span className="text-2xl sm:text-3xl font-black text-foreground">{counts.users}</span>
          <span className="text-xs sm:text-sm font-semibold uppercase text-muted-foreground">{t("nav.users")}</span>
        </Card>
      </section>

      {/* Main Grid: Elite Likes Stats Table & Chart */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Elite Users Table */}
        <Card className="lg:col-span-3 flex flex-col gap-4 p-5 bg-surface/90 border border-border/50 rounded-2xl">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Award className="h-5 w-5 text-accent" />
              {t("superAdmin.eliteLikesTitle")}
            </h3>
            <p className="text-xs text-muted-foreground">{t("superAdmin.eliteLikesDesc")}</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border/40 bg-surface/90 shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 text-muted-foreground/80 bg-surface/80 font-bold uppercase text-[10px]">
                <tr>
                  <th className="p-3 w-12 text-center">{t("superAdmin.rank")}</th>
                  <th className="p-3">{t("superAdmin.user")}</th>
                  <th className="p-3 text-right pr-6">{t("superAdmin.totalLikes")}</th>
                </tr>
              </thead>
              <tbody>
                {eliteUsers.map((u, i) => {
                  const colorIndex = i % segmentColors.length;
                  return (
                    <tr key={u.id} className="border-b border-border/40 last:border-0 hover:bg-surface/90 transition-colors">
                      <td className="p-3 text-center font-bold text-muted-foreground">
                        #{i + 1}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${segmentColors[colorIndex].split(" ")[1]}`} />
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">{u.firstName} {u.lastName}</span>
                            <span className="text-[10px] text-muted-foreground/70">ID: {u.publicId} · {u.email}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-right pr-6 font-bold text-foreground flex items-center justify-end gap-1.5 h-12">
                        <Heart className="h-3.5 w-3.5 text-rose-500 fill-rose-500" />
                        {u.likesReceived.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Donut Chart Card */}
        <Card className="lg:col-span-2 flex flex-col gap-4 p-5 bg-surface/90 border border-border/50 rounded-2xl">
          <div>
            <h3 className="text-base font-bold text-foreground">{t("superAdmin.likesDistribution")}</h3>
            <p className="text-xs text-muted-foreground">{t("superAdmin.likesDistributionDesc")}</p>
          </div>

          {totalLikes === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
              <Heart className="h-10 w-10 text-muted/30 mb-2" />
              <p className="text-xs text-muted-foreground">{t("superAdmin.noEliteLikes")}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-6 mt-2">
              {/* Donut Chart SVG */}
              <div className="relative h-[150px] w-[150px]">
                <svg viewBox="0 0 120 120" className="transform -rotate-90 h-full w-full">
                  <circle cx="60" cy="60" r={radius} fill="transparent" className="stroke-zinc-100 dark:stroke-zinc-800" strokeWidth="12" />
                  {eliteUsers.map((u, i) => {
                    const colorClass = segmentColors[i % segmentColors.length].split(" ")[0];
                    const percent = (u.likesReceived / totalLikes) * 100;
                    if (percent <= 0) return null;
                    const strokeLength = (percent / 100) * circumference;
                    const strokeOffset = circumference - (accumulatedPercent / 100) * circumference;
                    accumulatedPercent += percent;
                    return (
                      <circle
                        key={u.id}
                        cx="60"
                        cy="60"
                        r={radius}
                        fill="transparent"
                        className={colorClass}
                        strokeWidth="12"
                        strokeDasharray={`${strokeLength} ${circumference}`}
                        strokeDashoffset={strokeOffset}
                        strokeLinecap="round"
                      />
                    );
                  })}
                </svg>
                {/* Donut Label */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xs text-muted-foreground font-semibold">{t("superAdmin.totalLikes")}</span>
                  <span className="text-lg font-black text-foreground">{totalLikes.toLocaleString()}</span>
                </div>
              </div>

              {/* Chart Legend List */}
              <div className="w-full flex flex-col gap-2 border-t border-border/40 pt-4">
                {eliteUsers.slice(0, 5).map((u, i) => {
                  const pct = totalLikes > 0 ? ((u.likesReceived / totalLikes) * 100).toFixed(1) : "0";
                  const colorClass = textColors[i % textColors.length];
                  return (
                    <div key={u.id} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${segmentColors[i % segmentColors.length].split(" ")[1]}`} />
                        <span className="font-medium truncate max-w-[120px]">{u.firstName} {u.lastName}</span>
                      </div>
                      <span className={`font-bold ${colorClass}`}>{pct}% ({u.likesReceived})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
