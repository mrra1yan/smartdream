"use client";

import { useState, useEffect } from "react";
import { getWeeklyLikeStats } from "@/app/actions/chart";
import { useI18n } from "@/components/i18n-provider";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import { Loader2 } from "lucide-react";

export function WeeklyLikeChart({ userId }: { userId: string }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<{ name: string; date: string; given: number; taken: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // Helper to convert English digits to Bengali when locale is bn
  const toBengaliNumber = (num: number | string): string => {
    const str = String(num);
    if (locale !== "bn") return str;
    const bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
    return str.replace(/[0-9]/g, (digit) => bnDigits[parseInt(digit)]);
  };

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const result = await getWeeklyLikeStats(userId);
        const formatter = new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-US", { weekday: 'short' });
        const localizedData = result.stats.map((stat) => {
          const d = new Date(stat.date);
          return {
            ...stat,
            name: formatter.format(d)
          };
        });
        setData(localizedData);
      } catch (error) {
        console.error("Failed to load chart data:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [userId, locale]);

  return (
    <div className="w-full h-full min-h-[400px] flex flex-col gap-4 overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl">
      <style dangerouslySetInnerHTML={{ __html: `
        .recharts-wrapper:focus, .recharts-surface:focus, .recharts-surface *:focus {
          outline: none !important;
          -webkit-tap-highlight-color: transparent;
        }
      ` }} />
      <div className="flex items-center justify-between border-b border-border/20 pb-3 mb-1">
        <h3 className="text-sm font-bold text-foreground/90 uppercase">
          {t("stats.weeklyLikeStatistics")}
        </h3>
        <span className="text-xs font-bold uppercase text-muted-foreground/80">
          {t("stats.thisWeek")}
        </span>
      </div>

      <div className="flex-1 min-h-[300px] w-full relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 rounded-lg">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={data}
            margin={{
              top: 5,
              right: 10,
              left: -10,
              bottom: 5,
            }}
          >
            <defs>
              <linearGradient id="colorGiven" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity={1} />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.3} />
              </linearGradient>
              <linearGradient id="colorTaken" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a855f7" stopOpacity={1} />
                <stop offset="100%" stopColor="#a855f7" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" vertical={false} horizontal={true} stroke="var(--border)" opacity={0.8} />
            <XAxis 
              dataKey="name" 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 13, fill: "var(--muted)", fontWeight: 700 }}
              dy={10}
            />
            <YAxis 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "var(--muted)", fontWeight: 700 }}
              allowDecimals={false}
              tickFormatter={(value) => toBengaliNumber(value)}
            />
            <Tooltip 
              cursor={{ fill: "var(--muted)", opacity: 0.15 }}
              wrapperStyle={{ outline: "none" }}
              contentStyle={{ 
                borderRadius: "16px", 
                border: "1px solid var(--border)",
                backgroundColor: "var(--background)",
                boxShadow: "0 10px 25px -5px rgb(0 0 0 / 0.2), 0 8px 10px -6px rgb(0 0 0 / 0.1)"
              }}
              labelStyle={{ color: "var(--foreground)", fontWeight: 800, marginBottom: "8px", textTransform: "uppercase", fontSize: "12px" }}
              itemStyle={{ fontSize: "13px", fontWeight: 700 }}
              labelFormatter={(label, payload) => {
                if (payload && payload.length > 0 && payload[0].payload) {
                  return `${label} (${payload[0].payload.date})`;
                }
                return label;
              }}
            />
            <Legend 
              iconType="circle"
              wrapperStyle={{ fontSize: "13px", fontWeight: 700, paddingTop: "20px" }}
            />
            <Bar 
              dataKey="given" 
              name={t("stats.likesGiven")} 
              fill="url(#colorGiven)" 
              radius={[6, 6, 0, 0]}
              maxBarSize={32}
            />
            <Bar 
              dataKey="taken" 
              name={t("stats.likesReceived")} 
              fill="url(#colorTaken)" 
              radius={[6, 6, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
