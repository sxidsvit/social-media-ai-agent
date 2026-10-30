"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, BarChart3, CalendarRange, FolderKanban, Link2, Plus, RefreshCw, Settings } from "lucide-react";
import { syncAnalyticsNow } from "@/app/dashboard/analytics/actions";
import {
  byDay,
  byPlatform,
  inRange,
  matchesCampaign,
  platformColors,
  presetRange,
  previousRange,
  RANGE_PRESETS,
  rangeDays,
  summarize,
  SYNC_STALE_MS,
  type AnalyticsPost,
  type CampaignFilter,
  type DayRange,
  type RangePresetId,
  type SyncState,
} from "@/lib/analytics/shared";
import { formatDay } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import { ActivityChart, PlatformDonut, TrendChart } from "@/components/analytics/charts";
import { PANEL } from "@/components/analytics/chart-card";
import { StatCards } from "@/components/analytics/stat-cards";
import { TopPosts } from "@/components/analytics/top-posts";
import { OverviewEmptyState, OverviewPanel } from "@/components/dashboard/overview/overview-panel";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";

// The Analytics page: real metrics from the user's connected accounts (synced from Blotato), filtered
// by date range and campaign. Everything is worked out here from the synced posts, in the viewer's
// time zone, so every card, chart and table agrees and filters apply instantly. Syncs on load when
// the numbers are older than SYNC_STALE_MS.

type Props = {
  posts: AnalyticsPost[];
  sync: SyncState;
  campaigns: { id: number; name: string }[];
  activeCampaignId: number;
};

type RangeChoice = RangePresetId | "custom";
type Prefs = { range?: RangeChoice; campaign?: CampaignFilter; custom?: DayRange };

const PREFS_KEY = "analytics-prefs";

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private windows can refuse storage; the defaults are fine
  }
}

function syncedLabel(sync: SyncState) {
  return sync.lastSyncedAt ? `Synced ${formatDistanceToNow(new Date(sync.lastSyncedAt), { addSuffix: true })}` : "Not synced yet";
}

export function AnalyticsBoard({ posts, sync, campaigns, activeCampaignId }: Props) {
  const router = useRouter();
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [rangeChoice, setRangeChoice] = useState<RangeChoice>("30d");
  const [custom, setCustom] = useState<DayRange | null>(null);
  const [campaign, setCampaign] = useState<CampaignFilter>(activeCampaignId);
  const [syncing, startSync] = useTransition();
  const [syncError, setSyncError] = useState<string | null>(null);
  const autoSynced = useRef(false);

  // The zone and saved filters come from the browser, so they're read after mount
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const prefs = readPrefs();
    setTimeZone(zone);
    if (prefs.range && (prefs.range === "custom" || RANGE_PRESETS.some((preset) => preset.id === prefs.range))) setRangeChoice(prefs.range);
    if (prefs.custom?.from && prefs.custom?.to) setCustom(prefs.custom);
    if (prefs.campaign === "all" || prefs.campaign === "outside" || campaigns.some((item) => item.id === prefs.campaign)) setCampaign(prefs.campaign!);
  }, [campaigns]);

  useEffect(() => {
    if (timeZone) writePrefs({ range: rangeChoice, campaign, custom: custom ?? undefined });
  }, [timeZone, rangeChoice, campaign, custom]);

  function runSync() {
    startSync(async () => {
      const result = await syncAnalyticsNow();
      setSyncError(result.error ?? null);
      router.refresh();
    });
  }

  // Stale numbers sync once on load (by the last attempt, so a failing sync isn't retried in a loop)
  useEffect(() => {
    if (autoSynced.current || !sync.connected) return;
    const last = sync.lastAttemptAt ? Date.parse(sync.lastAttemptAt) : 0;
    if (Date.now() - last < SYNC_STALE_MS) return;
    autoSynced.current = true;
    runSync();
    // runSync only changes identity between renders; this runs once per stale load
  }, [sync.connected, sync.lastAttemptAt]);

  const range: DayRange | null = useMemo(() => {
    if (!timeZone) return null;
    if (rangeChoice === "custom" && custom && custom.from <= custom.to) return custom;
    const preset = RANGE_PRESETS.find((item) => item.id === rangeChoice) ?? RANGE_PRESETS[1];
    return presetRange(preset.days, timeZone);
  }, [timeZone, rangeChoice, custom]);

  // Colours from the whole dataset, so filtering never repaints a platform
  const colors = useMemo(() => platformColors(posts.map((post) => post.platform)), [posts]);
  const campaignNames = useMemo(() => new Map(campaigns.map((item) => [item.id, item.name])), [campaigns]);
  const scoped = useMemo(() => posts.filter((post) => matchesCampaign(post, campaign)), [posts, campaign]);

  const view = useMemo(() => {
    if (!range || !timeZone) return null;
    const current = scoped.filter((post) => inRange(post, range, timeZone));
    const before = scoped.filter((post) => inRange(post, previousRange(range), timeZone));
    const platformRows = byPlatform(current);
    return {
      current,
      summary: summarize(current),
      previous: summarize(before),
      days: byDay(current, range, timeZone),
      platformRows,
      // Every platform in the selection, in colour order, so the stack and legend stay put
      platforms: Object.keys(colors).filter((platform) => scoped.some((post) => post.platform === platform)),
    };
  }, [scoped, range, timeZone, colors]);

  if (!sync.connected && posts.length === 0) {
    return (
      <OverviewPanel>
        <OverviewEmptyState
          Icon={BarChart3}
          tone="bg-linear-to-br from-emerald-400 to-teal-600 text-white"
          glow="shadow-emerald-500/40"
          title="Connect your accounts to see analytics"
          description="Analytics come straight from your Instagram, TikTok, YouTube and other accounts through Blotato. Connect it once and your numbers sync automatically."
        >
          <Button size="lg" className="rounded-xl" nativeButton={false} render={<Link href="/dashboard/settings/integrations" />}>
            <Settings data-icon="inline-start" />
            Go to Settings → Integrations
          </Button>
        </OverviewEmptyState>
      </OverviewPanel>
    );
  }

  if (!timeZone || !range || !view) return <AnalyticsSkeleton />;

  const dayCount = rangeDays(range).length;
  const periodLabel = `previous ${dayCount} days`;
  const error = syncError ?? sync.lastError;
  const firstSync = !sync.lastSyncedAt && posts.length === 0;

  return (
    <div className="space-y-4">
      {/* Filters: one row above everything they scope */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Date range" className="inline-flex flex-wrap rounded-2xl bg-card p-1 ring-1 ring-border/60">
            {[...RANGE_PRESETS.map((preset) => ({ id: preset.id as RangeChoice, label: preset.label.replace("Last ", "") })), { id: "custom" as RangeChoice, label: "Custom" }].map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={rangeChoice === option.id}
                onClick={() => {
                  setRangeChoice(option.id);
                  if (option.id === "custom" && !custom) setCustom(range);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  rangeChoice === option.id ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option.id === "custom" && <CalendarRange className="size-3.5" />}
                {option.label}
              </button>
            ))}
          </div>

          {rangeChoice === "custom" && custom && (
            <div className="flex items-center gap-1.5 rounded-2xl bg-card px-2 py-1 ring-1 ring-border/60">
              <label className="sr-only" htmlFor="analytics-from">
                From
              </label>
              <input
                id="analytics-from"
                type="date"
                value={custom.from}
                max={custom.to}
                onChange={(event) => event.target.value && setCustom({ ...custom, from: event.target.value })}
                className="h-8 rounded-lg bg-transparent px-1.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <span className="text-muted-foreground">–</span>
              <label className="sr-only" htmlFor="analytics-to">
                To
              </label>
              <input
                id="analytics-to"
                type="date"
                value={custom.to}
                min={custom.from}
                max={presetRange(1, timeZone).to}
                onChange={(event) => event.target.value && setCustom({ ...custom, to: event.target.value })}
                className="h-8 rounded-lg bg-transparent px-1.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
          )}

          <div className="relative w-full sm:w-60">
            <FolderKanban className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <NativeSelect
              aria-label="Campaign"
              value={String(campaign)}
              onChange={(event) => {
                const value = event.target.value;
                setCampaign(value === "all" || value === "outside" ? value : Number(value));
              }}
              className="w-full [&_select]:h-10 [&_select]:rounded-2xl [&_select]:border-0 [&_select]:bg-card [&_select]:pl-8 [&_select]:text-sm [&_select]:ring-1 [&_select]:ring-border/60"
            >
              <NativeSelectOption value="all">All campaigns &amp; accounts</NativeSelectOption>
              {campaigns.map((item) => (
                <NativeSelectOption key={item.id} value={String(item.id)}>
                  {item.name}
                  {item.id === activeCampaignId ? " (current)" : ""}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value="outside">Posted outside the app</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-live="polite" className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", syncing ? "animate-pulse bg-amber-500" : error ? "bg-rose-500" : "bg-emerald-500")} />
            {syncing ? "Syncing with Blotato…" : syncedLabel(sync)}
          </span>
          {sync.connected && (
            <Button variant="outline" className="h-9 rounded-xl bg-card" onClick={runSync} disabled={syncing}>
              <RefreshCw data-icon="inline-start" className={cn(syncing && "animate-spin")} />
              Sync now
            </Button>
          )}
        </div>
      </div>

      <p className="-mt-1 text-xs text-muted-foreground">
        {formatDay(range.from, { month: "short", day: "numeric", year: range.from.slice(0, 4) === range.to.slice(0, 4) ? undefined : "numeric" })} –{" "}
        {formatDay(range.to, { month: "short", day: "numeric", year: "numeric" })} · {campaign === "all" ? "All campaigns and accounts" : campaign === "outside" ? "Posts made outside the app" : (campaignNames.get(campaign) ?? "Campaign")}
      </p>

      {!sync.connected && (
        <Banner tone="warning" action={<Link href="/dashboard/settings/integrations" className="font-medium underline underline-offset-4">Reconnect</Link>}>
          Blotato isn&apos;t connected, so these numbers can&apos;t update. They&apos;re from the last sync.
        </Banner>
      )}
      {sync.connected && error && !syncing && (
        <Banner tone="error" action={<button type="button" onClick={runSync} className="font-medium underline underline-offset-4">Try again</button>}>
          The last sync didn&apos;t finish: {error}
        </Banner>
      )}

      {firstSync ? (
        <OverviewPanel>
          <OverviewEmptyState
            Icon={syncing ? RefreshCw : Link2}
            tone="bg-linear-to-br from-emerald-400 to-teal-600 text-white"
            glow="shadow-emerald-500/40"
            title={syncing ? "Fetching your analytics…" : "No published posts yet"}
            description={
              syncing
                ? "Pulling your published posts and their metrics from your connected accounts. This takes a few seconds."
                : "Once posts go out on your connected accounts, their views and engagement show up here."
            }
          >
            {!syncing && (
              <Button size="lg" className="rounded-xl" nativeButton={false} render={<Link href="/dashboard/posts/create" />}>
                <Plus data-icon="inline-start" />
                Create a post
              </Button>
            )}
          </OverviewEmptyState>
        </OverviewPanel>
      ) : (
        <>
          <StatCards current={view.summary} previous={view.previous} periodLabel={periodLabel} dimmed={syncing} />

          <div className="grid gap-4 *:min-w-0 xl:grid-cols-2">
            <ActivityChart days={view.days} platforms={view.platforms} colors={colors} dimmed={syncing} />
            <TrendChart days={view.days} dimmed={syncing} />
          </div>

          <div className="grid gap-4 *:min-w-0 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <PlatformDonut rows={view.platformRows} colors={colors} dimmed={syncing} />
            <TopPosts posts={view.current} colors={colors} campaignNames={campaignNames} timeZone={timeZone} dimmed={syncing} />
          </div>

          {view.summary.awaitingMetrics > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              {view.summary.awaitingMetrics} of {view.summary.published} published post{view.summary.published === 1 ? "" : "s"} in this period {view.summary.awaitingMetrics === 1 ? "has" : "have"}n&apos;t reported metrics yet,
              so totals cover the rest. Platforms usually report within a day.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Banner({ tone, action, children }: { tone: "warning" | "error"; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2.5 text-sm ring-1",
        tone === "error" ? "bg-rose-500/8 text-rose-800 ring-rose-500/20 dark:text-rose-200" : "bg-amber-500/10 text-amber-900 ring-amber-500/20 dark:text-amber-200"
      )}
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading analytics">
      <div className="flex gap-2">
        <Skeleton className="h-10 w-80 rounded-2xl" />
        <Skeleton className="h-10 w-60 rounded-2xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className={cn(PANEL, "h-40")} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className={cn(PANEL, "h-80")} />
        <Skeleton className={cn(PANEL, "h-80")} />
      </div>
    </div>
  );
}
