import { addDays } from "@/lib/calendar";
import { utcToZonedParts } from "@/lib/posts/shared";

// Post analytics as both the server (sync, agent tools) and the browser (Analytics page) see them,
// and the maths both use, so the page and the Analytics Agent always agree. Not server-only.
//
// Missing data stays missing: a metric Blotato hasn't reported is null, never 0, and every total
// says how many posts it covers.

// One metrics snapshot from Blotato: when it was collected and the values as Blotato sent them
export type BlotatoMetricsSnapshot = { fetchedAt: string | null; metrics: Record<string, unknown> };

export const METRIC_KEYS = ["views", "likes", "comments", "shares", "saves", "reach", "impressions"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Record<MetricKey, number | null>;

export const METRIC_LABELS: Record<MetricKey, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  reach: "Reach",
  impressions: "Impressions",
};

// The names platforms (through Blotato) use for each metric
const METRIC_ALIASES: Record<MetricKey, string[]> = {
  views: ["views_count", "views", "view_count", "video_views", "video_views_count", "plays", "play_count"],
  likes: ["likes_count", "likes", "like_count", "reactions", "reactions_count", "favorites", "favorite_count"],
  comments: ["comments_count", "comments", "comment_count", "replies", "replies_count", "reply_count"],
  shares: ["shares_count", "shares", "share_count", "reposts", "reposts_count", "retweets", "retweet_count"],
  saves: ["saves_count", "saves", "saved", "saved_count", "bookmarks", "bookmark_count"],
  reach: ["reach_count", "reach"],
  impressions: ["impressions_count", "impressions", "impression_count"],
};

// "1,204", 1204 or { value: "1204" } → 1204; anything else → null
function toCount(value: unknown): number | null {
  if (value && typeof value === "object" && "value" in value) return toCount((value as { value: unknown }).value);
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.replace(/[,\s]/g, "")) : NaN;
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

// Blotato's metrics as the app's metric keys; a metric it didn't send is null
export function readMetrics(raw: Record<string, unknown> | null | undefined): Metrics {
  const lower = Object.fromEntries(Object.entries(raw ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const metrics = {} as Metrics;
  for (const key of METRIC_KEYS) {
    const alias = METRIC_ALIASES[key].find((name) => lower[name] !== undefined && toCount(lower[name]) !== null);
    metrics[key] = alias ? toCount(lower[alias]) : null;
  }
  return metrics;
}

export function hasAnyMetric(metrics: Metrics) {
  return METRIC_KEYS.some((key) => metrics[key] !== null);
}

// Likes, comments, shares and saves: the ones that were reported. null when none were.
export function engagementOf(metrics: Metrics) {
  const parts = [metrics.likes, metrics.comments, metrics.shares, metrics.saves].filter((value): value is number => value !== null);
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) : null;
}

// One post as the Analytics page and the agent tools see it
export type AnalyticsPost = {
  // Blotato's published post id
  id: string;
  platform: string;
  state: "published" | "failed";
  postedAt: string;
  text: string | null;
  postUrl: string | null;
  error: string | null;
  campaignId: number | null;
  // The app's post, when it came from the Posts page, and whether an agent made it
  postId: number | null;
  title: string | null;
  source: "manual" | "ai" | null;
  metrics: Metrics;
  metricsAt: string | null;
};

export type SyncState = {
  connected: boolean;
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
};

// The page syncs again on load once its numbers are older than this
export const SYNC_STALE_MS = 30 * 60 * 1000;
// How far back a sync reaches
export const SYNC_WINDOW_DAYS = 365;

// Date ranges: day keys ("YYYY-MM-DD", inclusive) in the viewer's time zone

export const RANGE_PRESETS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
] as const;
export type RangePresetId = (typeof RANGE_PRESETS)[number]["id"];

export type DayRange = { from: string; to: string };

export function dayKey(iso: string, timeZone: string) {
  return utcToZonedParts(new Date(iso), timeZone).date;
}

export function presetRange(days: number, timeZone: string): DayRange {
  const to = utcToZonedParts(new Date(), timeZone).date;
  return { from: addDays(to, -(days - 1)), to };
}

export function rangeDays({ from, to }: DayRange) {
  const days: string[] = [];
  for (let day = from; day <= to && days.length < 800; day = addDays(day, 1)) days.push(day);
  return days;
}

// The same number of days just before the range, to compare against
export function previousRange(range: DayRange): DayRange {
  const length = rangeDays(range).length;
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(length - 1)), to };
}

export function inRange(post: AnalyticsPost, range: DayRange, timeZone: string) {
  const day = dayKey(post.postedAt, timeZone);
  return day >= range.from && day <= range.to;
}

// Campaign filter: a campaign id, "all", or "outside" (posted straight from Blotato, not the app)
export type CampaignFilter = number | "all" | "outside";

export function matchesCampaign(post: AnalyticsPost, filter: CampaignFilter) {
  if (filter === "all") return true;
  if (filter === "outside") return post.campaignId === null;
  return post.campaignId === filter;
}

// Totals

// A sum over the posts that reported the metric, and how many did
export type MetricTotal = { total: number | null; reported: number };

function totalOf(posts: AnalyticsPost[], value: (post: AnalyticsPost) => number | null): MetricTotal {
  let total = 0;
  let reported = 0;
  for (const post of posts) {
    const v = value(post);
    if (v === null) continue;
    total += v;
    reported++;
  }
  return { total: reported ? total : null, reported };
}

// Estimated time saved, from the posts that went out through the app. Shown with these assumptions.
export const TIME_SAVED_ASSUMPTIONS = {
  // Formatting, uploading and posting one platform's post by hand
  minutesPerDelivery: 10,
  // Writing, designing and planning one post an AI agent made (counted once per post)
  minutesPerAiPost: 45,
};

export type Summary = {
  published: number;
  failed: number;
  // published / (published + failed); null with nothing attempted
  successRate: number | null;
  views: MetricTotal;
  likes: MetricTotal;
  comments: MetricTotal;
  shares: MetricTotal;
  saves: MetricTotal;
  reach: MetricTotal;
  engagement: MetricTotal;
  // Engagement / views over the posts that reported both; null without any
  engagementRate: number | null;
  // Published posts Blotato hasn't reported any metrics for yet
  awaitingMetrics: number;
  timeSavedMinutes: number;
  // Published posts that went out through the app (the ones time saved counts)
  appDeliveries: number;
  aiPosts: number;
};

export function summarize(posts: AnalyticsPost[]): Summary {
  const published = posts.filter((post) => post.state === "published");
  const failed = posts.length - published.length;
  const metric = (key: MetricKey) => totalOf(published, (post) => post.metrics[key]);

  const rated = published.filter((post) => post.metrics.views !== null && post.metrics.views > 0 && engagementOf(post.metrics) !== null);
  const ratedViews = rated.reduce((sum, post) => sum + post.metrics.views!, 0);
  const ratedEngagement = rated.reduce((sum, post) => sum + engagementOf(post.metrics)!, 0);

  const fromApp = published.filter((post) => post.postId !== null);
  const aiPosts = new Set(fromApp.filter((post) => post.source === "ai").map((post) => post.postId)).size;

  return {
    published: published.length,
    failed,
    successRate: posts.length ? published.length / posts.length : null,
    views: metric("views"),
    likes: metric("likes"),
    comments: metric("comments"),
    shares: metric("shares"),
    saves: metric("saves"),
    reach: metric("reach"),
    engagement: totalOf(published, (post) => engagementOf(post.metrics)),
    engagementRate: ratedViews ? ratedEngagement / ratedViews : null,
    awaitingMetrics: published.filter((post) => !hasAnyMetric(post.metrics)).length,
    timeSavedMinutes: fromApp.length * TIME_SAVED_ASSUMPTIONS.minutesPerDelivery + aiPosts * TIME_SAVED_ASSUMPTIONS.minutesPerAiPost,
    appDeliveries: fromApp.length,
    aiPosts,
  };
}

// Change against the previous period, as a fraction (0.25 = +25%); null when there's nothing to compare
export function change(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

// Per platform: posts, views and engagement, biggest first by posts
export type PlatformRow = { platform: string; published: number; failed: number; views: MetricTotal; engagement: MetricTotal };

export function byPlatform(posts: AnalyticsPost[]): PlatformRow[] {
  const groups = new Map<string, AnalyticsPost[]>();
  for (const post of posts) groups.set(post.platform, [...(groups.get(post.platform) ?? []), post]);
  return [...groups.entries()]
    .map(([platform, items]) => {
      const summary = summarize(items);
      return { platform, published: summary.published, failed: summary.failed, views: summary.views, engagement: summary.engagement };
    })
    .sort((a, b) => b.published - a.published || a.platform.localeCompare(b.platform));
}

// Per day of the range (in the time zone): published posts per platform, and the views and
// engagement of the posts published that day. A day with posts but no reported metric is null.
export type DayRow = {
  day: string;
  published: number;
  failed: number;
  perPlatform: Record<string, number>;
  views: number | null;
  engagement: number | null;
};

export function byDay(posts: AnalyticsPost[], range: DayRange, timeZone: string): DayRow[] {
  const rows = new Map(rangeDays(range).map((day) => [day, [] as AnalyticsPost[]]));
  for (const post of posts) rows.get(dayKey(post.postedAt, timeZone))?.push(post);
  return [...rows.entries()].map(([day, items]) => {
    const published = items.filter((post) => post.state === "published");
    const perPlatform: Record<string, number> = {};
    for (const post of published) perPlatform[post.platform] = (perPlatform[post.platform] ?? 0) + 1;
    const views = totalOf(published, (post) => post.metrics.views);
    const engagement = totalOf(published, (post) => engagementOf(post.metrics));
    return {
      day,
      published: published.length,
      failed: items.length - published.length,
      perPlatform,
      views: published.length ? views.total : 0,
      engagement: published.length ? engagement.total : 0,
    };
  });
}

// Ranking posts

export const SORT_METRICS = ["views", "likes", "comments", "shares", "saves", "engagement", "engagement_rate"] as const;
export type SortMetric = (typeof SORT_METRICS)[number];

export function sortValue(post: AnalyticsPost, metric: SortMetric) {
  if (metric === "engagement") return engagementOf(post.metrics);
  if (metric === "engagement_rate") {
    const engagement = engagementOf(post.metrics);
    return engagement !== null && post.metrics.views ? engagement / post.metrics.views : null;
  }
  return post.metrics[metric];
}

// Published posts that reported the metric, best (or worst) first
export function rankPosts(posts: AnalyticsPost[], metric: SortMetric, order: "best" | "worst" = "best") {
  return posts
    .filter((post) => post.state === "published" && sortValue(post, metric) !== null)
    .sort((a, b) => (order === "best" ? sortValue(b, metric)! - sortValue(a, metric)! : sortValue(a, metric)! - sortValue(b, metric)!));
}

// Platform colours: fixed categorical slots (validated for colour-blind separation in light and dark;
// app/globals.css --series-*), given out in this order to the platforms in the user's whole dataset, so a
// filter never repaints a platform. Past six, platforms share the neutral "other" colour.
const PLATFORM_ORDER = ["instagram", "tiktok", "youtube", "facebook", "x", "linkedin", "threads", "pinterest", "bluesky"];
const SERIES_SLOTS = 6;

export function platformColors(platforms: string[]) {
  const ordered = [...new Set(platforms)].sort((a, b) => {
    const [ia, ib] = [PLATFORM_ORDER.indexOf(a), PLATFORM_ORDER.indexOf(b)];
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return Object.fromEntries(ordered.map((platform, index) => [platform, index < SERIES_SLOTS ? `var(--series-${index + 1})` : "var(--series-other)"]));
}

// Formatting

export function formatCount(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number | null, digits = 1) {
  return value === null ? "—" : `${(value * 100).toFixed(digits).replace(/\.0+$/, "")}%`;
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
