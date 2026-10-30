"use client";

import { ArrowDownRight, ArrowUpRight, CheckCircle2, Clock, Eye, Info, Send, type LucideIcon } from "lucide-react";
import { change, formatCount, formatMinutes, formatPercent, TIME_SAVED_ASSUMPTIONS, type Summary } from "@/lib/analytics/shared";
import { cn } from "@/lib/utils";
import { PANEL } from "@/components/analytics/chart-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// The four headline numbers. Each compares with the previous period of the same length when both
// have a value; a metric nobody reported shows "—" with why, never 0.

type Card = {
  label: string;
  value: string;
  detail: string;
  Icon: LucideIcon;
  tile: string;
  delta: number | null;
  info?: string;
};

function Delta({ value, period }: { value: number | null; period: string }) {
  if (value === null) return <span className="text-xs text-muted-foreground">No earlier data to compare</span>;
  const up = value >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums",
          up ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"
        )}
      >
        <Arrow className="size-3" aria-hidden />
        {up ? "+" : ""}
        {formatPercent(value)}
      </span>
      <span className="text-muted-foreground">vs {period}</span>
    </span>
  );
}

export function StatCards({ current, previous, periodLabel, dimmed }: { current: Summary; previous: Summary; periodLabel: string; dimmed?: boolean }) {
  const viewsDetail =
    current.views.total === null
      ? current.published
        ? "Not reported by the platforms yet"
        : "No posts published in this period"
      : current.views.reported < current.published
        ? `From ${current.views.reported} of ${current.published} posts; the rest haven't reported views`
        : `Across ${current.published} post${current.published === 1 ? "" : "s"}`;

  const cards: Card[] = [
    {
      label: "Posts published",
      value: current.published.toLocaleString("en-US"),
      detail: current.failed ? `${current.failed} failed to publish` : "None failed",
      Icon: Send,
      tile: "bg-linear-to-br from-blue-500 to-indigo-600 shadow-blue-500/30",
      delta: change(current.published, previous.published),
    },
    {
      label: "Total views",
      value: formatCount(current.views.total),
      detail: viewsDetail,
      Icon: Eye,
      tile: "bg-linear-to-br from-violet-500 to-fuchsia-600 shadow-violet-500/30",
      delta: change(current.views.total, previous.views.total),
    },
    {
      label: "Publishing success rate",
      value: formatPercent(current.successRate),
      detail: current.successRate === null ? "Nothing was published in this period" : `${current.published} of ${current.published + current.failed} went out`,
      Icon: CheckCircle2,
      tile: "bg-linear-to-br from-emerald-400 to-teal-600 shadow-emerald-500/30",
      delta: current.successRate !== null && previous.successRate !== null ? current.successRate - previous.successRate : null,
    },
    {
      label: "Est. time saved",
      value: formatMinutes(current.timeSavedMinutes),
      detail: current.appDeliveries
        ? `${current.appDeliveries} platform post${current.appDeliveries === 1 ? "" : "s"} sent by the app · ${current.aiPosts} made by AI`
        : "Counts posts sent from the app",
      Icon: Clock,
      tile: "bg-linear-to-br from-amber-400 to-orange-500 shadow-orange-500/30",
      delta: change(current.timeSavedMinutes, previous.timeSavedMinutes),
      info: `An estimate, not a measurement: ${TIME_SAVED_ASSUMPTIONS.minutesPerDelivery} minutes for each platform post the app published for you, plus ${TIME_SAVED_ASSUMPTIONS.minutesPerAiPost} minutes for each post your AI team wrote and designed.`,
    },
  ];

  return (
    <div className={cn("grid gap-3 transition-opacity *:min-w-0 sm:grid-cols-2 xl:grid-cols-4", dimmed && "opacity-60")}>
      {cards.map((card) => (
        <article key={card.label} className={cn(PANEL, "group relative overflow-hidden p-5")}>
          <div aria-hidden className={cn("pointer-events-none absolute -top-10 -right-10 size-28 rounded-full opacity-[0.07] blur-2xl transition-opacity group-hover:opacity-15", card.tile)} />
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
              {card.label}
              {card.info && (
                <Tooltip>
                  <TooltipTrigger
                    render={<button type="button" className="rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />}
                  >
                    <Info className="size-3.5" />
                    <span className="sr-only">How this is estimated</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64 text-pretty">{card.info}</TooltipContent>
                </Tooltip>
              )}
            </p>
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-lg", card.tile)}>
              <card.Icon className="size-4" />
            </span>
          </div>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{card.value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={card.detail}>
            {card.detail}
          </p>
          <div className="mt-3 border-t border-border/60 pt-3">
            {card.label === "Publishing success rate" && card.delta !== null ? (
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">
                  {card.delta >= 0 ? "+" : ""}
                  {(card.delta * 100).toFixed(1).replace(/\.0$/, "")} pts
                </span>{" "}
                vs {periodLabel}
              </span>
            ) : (
              <Delta value={card.delta} period={periodLabel} />
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
