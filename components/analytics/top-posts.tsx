"use client";

import { useState } from "react";
import { ExternalLink, Hourglass, Trophy } from "lucide-react";
import { dayKey, engagementOf, formatCount, formatPercent, hasAnyMetric, rankPosts, sortValue, type AnalyticsPost, type SortMetric } from "@/lib/analytics/shared";
import { formatDay } from "@/lib/calendar";
import { platformName } from "@/lib/social-platforms";
import { cn } from "@/lib/utils";
import { PANEL, PlatformMark, Segmented } from "@/components/analytics/chart-card";

// The period's best posts by a metric. Posts that haven't reported it yet are counted, not ranked.

const LIMIT = 6;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className={cn("text-sm font-semibold tabular-nums", value === "—" && "font-normal text-muted-foreground")} title={value === "—" ? "Not reported yet" : undefined}>
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function TopPosts({
  posts,
  colors,
  campaignNames,
  timeZone,
  dimmed,
}: {
  posts: AnalyticsPost[];
  colors: Record<string, string>;
  campaignNames: Map<number, string>;
  timeZone: string;
  dimmed?: boolean;
}) {
  const published = posts.filter((post) => post.state === "published");
  const [metric, setMetric] = useState<SortMetric>("views");
  const ranked = rankPosts(published, metric);
  const awaiting = published.filter((post) => !hasAnyMetric(post.metrics)).length;
  const unranked = published.length - ranked.length;

  return (
    <section className={cn(PANEL, "p-5 sm:p-6")}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Top posts</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {published.length ? `Ranked by ${metric === "engagement_rate" ? "engagement rate" : metric}${unranked ? ` · ${unranked} not ranked (metric not reported yet)` : ""}` : "Your best performing posts in this period"}
          </p>
        </div>
        <Segmented
          label="Rank by"
          value={metric}
          onChange={setMetric}
          options={[
            { id: "views", label: "Views" },
            { id: "engagement", label: "Engagement" },
            { id: "engagement_rate", label: "Eng. rate" },
            { id: "comments", label: "Comments" },
          ]}
        />
      </header>

      <div className={cn("transition-opacity", dimmed && "opacity-60")}>
        {ranked.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl bg-muted/40 px-6 py-10 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-card text-muted-foreground shadow-sm ring-1 ring-border/60">
              {published.length ? <Hourglass className="size-4" /> : <Trophy className="size-4" />}
            </span>
            <p className="text-sm font-medium">{published.length ? "Waiting for metrics" : "No published posts in this period"}</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {published.length
                ? `${published.length} post${published.length === 1 ? " is" : "s are"} out, but the platforms haven't reported this metric yet. It usually shows up within a day.`
                : "Once your posts go out, the best ones will be ranked here."}
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-border/60">
            {ranked.slice(0, LIMIT).map((post, index) => {
              const rate = sortValue(post, "engagement_rate");
              const label = post.title ?? post.text?.replace(/\s+/g, " ").trim() ?? "Untitled post";
              const campaign = post.campaignId !== null ? campaignNames.get(post.campaignId) : null;
              return (
                <li key={post.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className={cn("w-5 text-center text-sm font-semibold tabular-nums", index === 0 ? "text-amber-500" : "text-muted-foreground")}>{index + 1}</span>
                  <PlatformMark platform={post.platform} color={colors[post.platform]} className="size-8 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={label}>
                      {label}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {platformName(post.platform)} · {formatDay(dayKey(post.postedAt, timeZone), { month: "short", day: "numeric" })}
                      {campaign ? ` · ${campaign}` : post.campaignId === null ? " · Outside the app" : ""}
                    </p>
                  </div>
                  <div className="hidden gap-5 sm:flex">
                    <Metric label="Views" value={formatCount(post.metrics.views)} />
                    <Metric label="Engagement" value={formatCount(engagementOf(post.metrics))} />
                    <Metric label="Eng. rate" value={formatPercent(rate, 1)} />
                  </div>
                  <div className="sm:hidden">
                    <Metric label={metric === "engagement_rate" ? "Eng. rate" : metric} value={metric === "engagement_rate" ? formatPercent(rate) : formatCount(sortValue(post, metric))} />
                  </div>
                  {post.postUrl ? (
                    <a
                      href={post.postUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      aria-label={`Open on ${platformName(post.platform)}`}
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    <span className="size-8 shrink-0" />
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {awaiting > 0 && ranked.length > 0 && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Hourglass className="size-3" />
            {awaiting} post{awaiting === 1 ? " is" : "s are"} still waiting for the platforms to report metrics.
          </p>
        )}
      </div>
    </section>
  );
}
