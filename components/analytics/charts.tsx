"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { formatDay } from "@/lib/calendar";
import { formatCount, formatPercent, type DayRow, type PlatformRow } from "@/lib/analytics/shared";
import { platformName } from "@/lib/social-platforms";
import { cn } from "@/lib/utils";
import { ChartCard, ChartEmpty, DataTable, PlatformKey, Segmented } from "@/components/analytics/chart-card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

// The Analytics page's charts. Platforms keep one colour everywhere (platformColors). Each has a
// table view with the same numbers, and a missing metric is a gap, never a 0.

// Axis ticks stay short: 8K, 1.2M
const axisCount = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const shortDay = (day: string) => formatDay(day, { month: "short", day: "numeric" });
const longDay = (day: string) => formatDay(day, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

// Fewer axis labels on long ranges
function tickGap(days: number) {
  return days > 60 ? 28 : days > 20 ? 20 : 12;
}

// Daily posting activity: posts published each day, stacked by platform
export function ActivityChart({ days, platforms, colors, dimmed }: { days: DayRow[]; platforms: string[]; colors: Record<string, string>; dimmed?: boolean }) {
  const config = useMemo(
    () => Object.fromEntries(platforms.map((platform) => [platform, { label: platformName(platform), color: colors[platform] }])) satisfies ChartConfig,
    [platforms, colors]
  );
  const data = days.map((row) => ({ day: row.day, ...Object.fromEntries(platforms.map((platform) => [platform, row.perPlatform[platform] ?? 0])) }));
  const total = days.reduce((sum, row) => sum + row.published, 0);
  const busiest = days.reduce<DayRow | null>((best, row) => (row.published > (best?.published ?? 0) ? row : best), null);

  return (
    <ChartCard
      title="Daily posting activity"
      subtitle={total ? `${total} published${busiest ? ` · busiest day ${shortDay(busiest.day)} (${busiest.published})` : ""}` : "Posts published each day"}
      table={
        <DataTable
          head={["Day", ...platforms.map(platformName), "Failed"]}
          rows={days.filter((row) => row.published || row.failed).map((row) => [longDay(row.day), ...platforms.map((platform) => row.perPlatform[platform] ?? 0), row.failed])}
        />
      }
    >
      <div className={cn("transition-opacity", dimmed && "opacity-60")}>
        {platforms.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
            {platforms.map((platform) => (
              <PlatformKey key={platform} platform={platform} color={colors[platform]} />
            ))}
          </div>
        )}
        <div className="relative">
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={tickGap(days.length)} tickFormatter={shortDay} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
              <ChartTooltip cursor={{ fillOpacity: 0.6 }} content={<ChartTooltipContent indicator="line" labelFormatter={(_, payload) => longDay(String(payload?.[0]?.payload?.day ?? ""))} />} />
              {platforms.map((platform, index) => (
                <Bar
                  key={platform}
                  dataKey={platform}
                  stackId="posts"
                  fill={`var(--color-${platform})`}
                  stroke="var(--card)"
                  strokeWidth={1}
                  maxBarSize={28}
                  radius={index === platforms.length - 1 ? [4, 4, 0, 0] : 0}
                />
              ))}
            </BarChart>
          </ChartContainer>
          {total === 0 && <ChartEmpty title="Nothing published in this period" description="Posts appear here once they go out on your connected accounts." />}
        </div>
      </div>
    </ChartCard>
  );
}

type TrendMetric = "views" | "engagement";

// Views or engagement of the posts published each day (one measure at a time, one axis)
export function TrendChart({ days, dimmed }: { days: DayRow[]; dimmed?: boolean }) {
  const [metric, setMetric] = useState<TrendMetric>("views");
  const label = metric === "views" ? "Views" : "Engagement";
  const config = { [metric]: { label, color: "var(--series-1)" } } satisfies ChartConfig;
  const reported = days.filter((row) => row[metric] !== null && row.published > 0);
  const total = reported.reduce((sum, row) => sum + (row[metric] ?? 0), 0);
  const missingDays = days.filter((row) => row.published > 0 && row[metric] === null).length;
  const peak = reported.reduce<DayRow | null>((best, row) => ((row[metric] ?? 0) > (best?.[metric] ?? 0) ? row : best), null);

  return (
    <ChartCard
      title="Views & engagement"
      subtitle={
        reported.length
          ? `${formatCount(total)} ${label.toLowerCase()} on posts published in this period${peak ? ` · peak ${shortDay(peak.day)}` : ""}${missingDays ? ` · ${missingDays} day${missingDays === 1 ? "" : "s"} not reported yet` : ""}`
          : "By the day each post was published"
      }
      controls={
        <Segmented
          label="Metric"
          value={metric}
          onChange={setMetric}
          options={[
            { id: "views", label: "Views" },
            { id: "engagement", label: "Engagement" },
          ]}
        />
      }
      table={
        <DataTable
          head={["Published on", "Posts", "Views", "Engagement"]}
          rows={days.filter((row) => row.published).map((row) => [longDay(row.day), row.published, formatCount(row.views), formatCount(row.engagement)])}
        />
      }
    >
      <div className={cn("relative transition-opacity", dimmed && "opacity-60")}>
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <AreaChart data={days} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`var(--color-${metric})`} stopOpacity={0.22} />
                <stop offset="100%" stopColor={`var(--color-${metric})`} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={tickGap(days.length)} tickFormatter={shortDay} />
            <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={axisCount} />
            <ChartTooltip
              cursor={{ strokeWidth: 1 }}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(_, payload) => {
                    const row = payload?.[0]?.payload as DayRow | undefined;
                    return row ? `${longDay(row.day)} · ${row.published} post${row.published === 1 ? "" : "s"}` : "";
                  }}
                />
              }
            />
            <Area
              key={metric}
              dataKey={metric}
              type="monotone"
              stroke={`var(--color-${metric})`}
              strokeWidth={2}
              fill="url(#trend-fill)"
              connectNulls={false}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            />
          </AreaChart>
        </ChartContainer>
        {!reported.length && (
          <ChartEmpty
            title={`No ${label.toLowerCase()} reported yet`}
            description={
              days.some((row) => row.published)
                ? "Your platforms report metrics a while after a post goes out. They'll show up here after the next sync."
                : "Nothing was published in this period."
            }
          />
        )}
      </div>
    </ChartCard>
  );
}

type ShareMetric = "views" | "engagement" | "published";
const MAX_SLICES = 5;

// Platform-wise performance: each platform's share of views, engagement or posts
export function PlatformDonut({ rows, colors, dimmed }: { rows: PlatformRow[]; colors: Record<string, string>; dimmed?: boolean }) {
  const hasViews = rows.some((row) => row.views.total !== null);
  const [picked, setMetric] = useState<ShareMetric | null>(null);
  const metric = picked ?? (hasViews ? "views" : "published");
  const valueOf = (row: PlatformRow) => (metric === "published" ? row.published : (row[metric].total ?? null));

  // Biggest first; past five, the rest fold into "Other"
  const ranked = rows.map((row) => ({ platform: row.platform, value: valueOf(row), row })).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const slices = ranked.slice(0, MAX_SLICES).filter((item) => (item.value ?? 0) > 0);
  const rest = ranked.slice(MAX_SLICES).reduce((sum, item) => sum + (item.value ?? 0), 0);
  const data = [
    ...slices.map((item) => ({ key: item.platform, name: platformName(item.platform), value: item.value!, fill: colors[item.platform] })),
    ...(rest > 0 ? [{ key: "other", name: "Other", value: rest, fill: "var(--series-other)" }] : []),
  ];
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const metricLabel = metric === "published" ? "posts" : metric;
  const config = Object.fromEntries(data.map((item) => [item.key, { label: item.name, color: item.fill }])) satisfies ChartConfig;

  return (
    <ChartCard
      title="Platform performance"
      subtitle={`Share of ${metricLabel} by platform`}
      controls={
        <Segmented
          label="Metric"
          value={metric}
          onChange={setMetric}
          options={[
            { id: "views", label: "Views" },
            { id: "engagement", label: "Engagement" },
            { id: "published", label: "Posts" },
          ]}
        />
      }
      table={
        <DataTable
          head={["Platform", "Posts", "Failed", "Views", "Engagement"]}
          rows={rows.map((row) => [platformName(row.platform), row.published, row.failed, formatCount(row.views.total), formatCount(row.engagement.total)])}
        />
      }
    >
      <div className={cn("grid items-center gap-4 transition-opacity sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", dimmed && "opacity-60")}>
        <div className="relative mx-auto aspect-square w-full max-w-56">
          {total > 0 ? (
            <>
              <ChartContainer config={config} className="aspect-square w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="key" indicator="line" />} />
                  <Pie data={data} dataKey="value" nameKey="key" innerRadius="66%" outerRadius="100%" paddingAngle={data.length > 1 ? 2 : 0} cornerRadius={4} stroke="var(--card)" strokeWidth={2}>
                    {data.map((item) => (
                      <Cell key={item.key} fill={item.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatCount(total)}</span>
                <span className="text-xs text-muted-foreground">{metricLabel}</span>
              </div>
            </>
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-full border-[14px] border-muted">
              <span className="max-w-24 text-center text-xs text-muted-foreground">{rows.length ? `No ${metricLabel} reported yet` : "No posts in this period"}</span>
            </div>
          )}
        </div>

        <ul className="space-y-2">
          {ranked.map((item) => (
            <li key={item.platform} className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/50">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: colors[item.platform] }} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{platformName(item.platform)}</span>
              <span className="text-sm font-semibold tabular-nums">{formatCount(item.value)}</span>
              <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{item.value !== null && total ? formatPercent(item.value / total, 0) : "—"}</span>
            </li>
          ))}
          {ranked.length === 0 && <li className="text-sm text-muted-foreground">No platforms in this period.</li>}
        </ul>
      </div>
    </ChartCard>
  );
}
