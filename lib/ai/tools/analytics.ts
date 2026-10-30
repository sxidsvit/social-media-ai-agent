import "server-only";
import { tool, type RunContext } from "@openai/agents";
import { formatDistanceToNow } from "date-fns";
import { z } from "zod";
import type { WorkerContext } from "@/lib/ai/tools/context";
import { setStep } from "@/lib/ai/tools/runtime";
import {
  byPlatform,
  change,
  engagementOf,
  formatCount,
  formatPercent,
  inRange,
  METRIC_KEYS,
  METRIC_LABELS,
  presetRange,
  previousRange,
  rankPosts,
  readMetrics,
  SORT_METRICS,
  sortValue,
  summarize,
  TIME_SAVED_ASSUMPTIONS,
  type AnalyticsPost,
  type DayRange,
  type MetricTotal,
} from "@/lib/analytics/shared";
import { getSyncState, listAnalyticsPosts, refreshPostAnalytics, syncAnalytics } from "@/lib/analytics/store";
import type { Scope } from "@/lib/orchestration/store";
import { platformName } from "@/lib/social-platforms";

// The Analytics Agent's tools: real performance data from the user's connected accounts, synced from
// Blotato into post_analytics (lib/analytics/store.ts) and summed up with the same maths as the
// Analytics page (lib/analytics/shared.ts). Used in its task runs and in its chat, so the context
// only needs the scope. Every answer says what a number covers and what's missing; nothing is
// estimated except time saved, which says so.

// How the Analytics Agent works with real data, in its tasks and its chat
export const ANALYTICS_DATA_RULES = `How you work with the numbers:
- Your data is real: the user's published posts and the metrics their platforms reported, synced
  from their connected accounts through Blotato. Call sync_analytics once at the start of a report,
  then get_analytics_summary for the headline numbers and list_post_performance for the best and
  weakest posts. Use get_post_analytics for one post's trend over time.
- Pick the scope from the request: "campaign" for this campaign's posts (the default), or
  "all_accounts" when the user asks about their accounts as a whole. Use the period, platforms and
  time zone the request gives; with no period, use the last 30 days.
- Only report numbers a tool returned. Never invent, round up or fill in a figure. If a metric isn't
  reported (some platforms don't share every metric, and new posts take time), say so plainly and
  report what is there. Say how many posts a total covers when it's not all of them.
- If Blotato isn't connected or the sync fails, say so, report from what's already synced (with when
  it's from), and tell the user how to fix it (Settings → Integrations).
- Compare with the previous period when the tools give it, and explain what stood out with the posts
  behind it (link and id). Time saved is an estimate: always call it one.
- Recommendations follow from the data: tie each to the numbers that support it, most important first.`;

export type AnalyticsToolContext = { scope?: Scope; task?: WorkerContext["task"] };

function scopeOf(runContext: RunContext<AnalyticsToolContext> | undefined) {
  const scope = runContext?.context.scope;
  if (!scope) throw new Error("Analytics tools need the user's campaign.");
  return scope;
}

async function step(runContext: RunContext<AnalyticsToolContext> | undefined, text: string) {
  const context = runContext?.context;
  if (context?.task) await setStep(context as WorkerContext, text);
}

const DataScope = z
  .enum(["campaign", "all_accounts"])
  .describe('"campaign": only posts this campaign published through the app; "all_accounts": everything on the user\'s connected accounts, including posts made outside the app');

const Period = {
  days: z.number().int().min(1).max(365).nullable().describe("The last N days, today included (null with since/until, else 30)"),
  since: z.string().nullable().describe("First day, YYYY-MM-DD (with until); null to use days"),
  until: z.string().nullable().describe("Last day, YYYY-MM-DD; null for today"),
  time_zone: z.string().nullable().describe("IANA time zone the days are in; null for UTC"),
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function readPeriod(input: { days: number | null; since: string | null; until: string | null; time_zone: string | null }) {
  const timeZone = input.time_zone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    return { error: `"${timeZone}" isn't a time zone. Use an IANA name like "Asia/Kolkata".` } as const;
  }
  if (input.since) {
    const until = input.until ?? presetRange(1, timeZone).to;
    if (!DAY.test(input.since) || !DAY.test(until) || input.since > until) return { error: "since and until must be YYYY-MM-DD, with since first." } as const;
    return { range: { from: input.since, to: until } as DayRange, timeZone } as const;
  }
  return { range: presetRange(input.days ?? 30, timeZone), timeZone } as const;
}

async function loadPosts(scope: Scope, which: "campaign" | "all_accounts", platform: string | null) {
  const posts = await listAnalyticsPosts(scope.userId, which === "campaign" ? { campaignId: scope.campaignId } : {});
  return platform ? posts.filter((post) => post.platform === platform.toLowerCase()) : posts;
}

async function freshness(scope: Scope) {
  const sync = await getSyncState(scope.userId);
  if (!sync.connected) return "Blotato isn't connected, so there's no real data. The user connects it in Settings → Integrations.";
  const synced = sync.lastSyncedAt ? `Data synced from Blotato ${formatDistanceToNow(new Date(sync.lastSyncedAt), { addSuffix: true })}.` : "Never synced: call sync_analytics first.";
  return sync.lastError ? `${synced} The last sync failed: ${sync.lastError}` : synced;
}

function describeTotal(label: string, total: MetricTotal, published: number) {
  if (total.total === null) return `${label}: not reported yet`;
  const coverage = total.reported < published ? ` (from ${total.reported} of ${published} posts; the others haven't reported it)` : "";
  return `${label}: ${total.total.toLocaleString("en-US")}${coverage}`;
}

function describeChange(current: number | null, previous: number | null) {
  const delta = change(current, previous);
  return delta === null ? "" : ` (${delta >= 0 ? "+" : ""}${formatPercent(delta)} vs the previous period)`;
}

function describePost(post: AnalyticsPost) {
  const metrics = METRIC_KEYS.filter((key) => post.metrics[key] !== null).map((key) => `${METRIC_LABELS[key].toLowerCase()} ${post.metrics[key]!.toLocaleString("en-US")}`);
  const engagement = engagementOf(post.metrics);
  const rate = sortValue(post, "engagement_rate");
  const label = post.title ?? (post.text ? `"${post.text.replace(/\s+/g, " ").slice(0, 80)}${post.text.length > 80 ? "…" : ""}"` : "(no text)");
  return [
    `- ${platformName(post.platform)} · ${post.postedAt.slice(0, 10)} · ${label} [id ${post.id}]`,
    metrics.length ? `  ${metrics.join(", ")}${engagement !== null ? `; engagement ${engagement.toLocaleString("en-US")}` : ""}${rate !== null ? ` (${formatPercent(rate, 2)} of views)` : ""}` : "  No metrics reported yet",
    post.postUrl ? `  ${post.postUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const syncAnalyticsTool = tool({
  name: "sync_analytics",
  description: "Pull the latest published posts and their metrics from the user's connected accounts (through Blotato). Call it once before reporting, so the numbers are current.",
  parameters: z.object({}),
  execute: async (_input, runContext?: RunContext<AnalyticsToolContext>) => {
    const scope = scopeOf(runContext);
    await step(runContext, "Syncing analytics from Blotato");
    const result = await syncAnalytics(scope.userId);
    if (result.error) return `Sync failed: ${result.error} Report from the data already synced, and say it may be out of date. ${await freshness(scope)}`;
    return `Synced ${result.synced} published and failed posts from the last year (${result.linked} matched to posts made in this app).`;
  },
});

export const getAnalyticsSummary = tool({
  name: "get_analytics_summary",
  description:
    "Headline numbers for a period: posts published and failed, success rate, views, likes, comments, shares, saves, reach, engagement and engagement rate, per platform, compared with the previous period of the same length. Says which metrics haven't been reported.",
  parameters: z.object({
    scope: DataScope,
    platform: z.string().nullable().describe("Only this platform (instagram, tiktok, youtube, x, linkedin, facebook…), or null for all"),
    ...Period,
  }),
  execute: async (input, runContext?: RunContext<AnalyticsToolContext>) => {
    const scope = scopeOf(runContext);
    const period = readPeriod(input);
    if ("error" in period) return period.error;
    const { range, timeZone } = period;
    await step(runContext, "Reading the analytics");

    const posts = await loadPosts(scope, input.scope, input.platform);
    const current = posts.filter((post) => inRange(post, range, timeZone));
    const before = posts.filter((post) => inRange(post, previousRange(range), timeZone));
    const now = summarize(current);
    const prev = summarize(before);
    const header = `Period ${range.from} to ${range.to} (${timeZone}), ${input.scope === "campaign" ? "this campaign's posts" : "all connected accounts"}${input.platform ? `, ${platformName(input.platform)} only` : ""}. ${await freshness(scope)}`;
    if (current.length === 0) return `${header}\nNo posts were published or failed in this period.${before.length ? ` The previous period had ${prev.published} published.` : ""}`;

    const lines = [
      header,
      `Published: ${now.published}${describeChange(now.published, prev.published)}; failed: ${now.failed}; success rate ${formatPercent(now.successRate)}`,
      `${describeTotal("Views", now.views, now.published)}${describeChange(now.views.total, prev.views.total)}`,
      describeTotal("Likes", now.likes, now.published),
      describeTotal("Comments", now.comments, now.published),
      describeTotal("Shares", now.shares, now.published),
      describeTotal("Saves", now.saves, now.published),
      describeTotal("Reach", now.reach, now.published),
      `${describeTotal("Engagement (likes + comments + shares + saves)", now.engagement, now.published)}${describeChange(now.engagement.total, prev.engagement.total)}`,
      `Engagement rate: ${now.engagementRate === null ? "can't be worked out (no posts reported both views and engagement)" : `${formatPercent(now.engagementRate, 2)} of views`}`,
      now.awaitingMetrics ? `${now.awaitingMetrics} published post${now.awaitingMetrics === 1 ? " has" : "s have"} no metrics yet (platforms report them some time after posting).` : "",
      `Estimated time saved: ${now.timeSavedMinutes} minutes (an estimate: ${TIME_SAVED_ASSUMPTIONS.minutesPerDelivery} min per platform post sent through the app, ${now.appDeliveries} of them, plus ${TIME_SAVED_ASSUMPTIONS.minutesPerAiPost} min per post an agent made, ${now.aiPosts} of them).`,
      "Per platform:",
      ...byPlatform(current).map(
        (row) => `- ${platformName(row.platform)}: ${row.published} published, ${row.failed} failed; views ${formatCount(row.views.total)}${row.views.total !== null && row.views.reported < row.published ? ` (${row.views.reported} reported)` : ""}; engagement ${formatCount(row.engagement.total)}`
      ),
    ];
    return lines.filter(Boolean).join("\n");
  },
});

export const listPostPerformance = tool({
  name: "list_post_performance",
  description: "Rank published posts in a period by a metric: the best (or weakest) posts, with their metrics, links and Blotato ids. Posts that didn't report the metric are left out and counted.",
  parameters: z.object({
    scope: DataScope,
    platform: z.string().nullable().describe("Only this platform, or null for all"),
    sort_by: z.enum(SORT_METRICS),
    order: z.enum(["best", "worst"]),
    limit: z.number().int().min(1).max(20),
    ...Period,
  }),
  execute: async (input, runContext?: RunContext<AnalyticsToolContext>) => {
    const scope = scopeOf(runContext);
    const period = readPeriod(input);
    if ("error" in period) return period.error;
    const { range, timeZone } = period;
    await step(runContext, `Ranking posts by ${input.sort_by.replace("_", " ")}`);

    const published = (await loadPosts(scope, input.scope, input.platform)).filter((post) => post.state === "published" && inRange(post, range, timeZone));
    const ranked = rankPosts(published, input.sort_by, input.order);
    const header = `${input.order === "best" ? "Top" : "Weakest"} posts by ${input.sort_by.replace("_", " ")}, ${range.from} to ${range.to} (${timeZone}). ${await freshness(scope)}`;
    if (!published.length) return `${header}\nNo published posts in this period.`;
    if (!ranked.length) return `${header}\nNone of the ${published.length} published posts has reported ${input.sort_by.replace("_", " ")} yet.`;
    const missing = published.length - ranked.length;
    return [header, ...ranked.slice(0, input.limit).map(describePost), missing ? `${missing} more published post${missing === 1 ? "" : "s"} didn't report this metric yet.` : ""]
      .filter(Boolean)
      .join("\n");
  },
});

export const getPostAnalyticsTool = tool({
  name: "get_post_analytics",
  description: "One published post's latest metrics and how they changed over time, fetched live from Blotato. Takes the post's Blotato id (from list_post_performance).",
  parameters: z.object({ post_id: z.string().describe("The post's Blotato id") }),
  execute: async ({ post_id }, runContext?: RunContext<AnalyticsToolContext>) => {
    const scope = scopeOf(runContext);
    await step(runContext, "Fetching a post's analytics");
    let result;
    try {
      result = await refreshPostAnalytics(scope.userId, post_id);
    } catch (error) {
      return `Couldn't fetch it from Blotato: ${(error as Error).message}`;
    }
    if ("error" in result) return result.error;
    const history = result.history
      .slice(-10)
      .map((snapshot) => {
        const metrics = readMetrics(snapshot.metrics);
        const values = METRIC_KEYS.filter((key) => metrics[key] !== null).map((key) => `${METRIC_LABELS[key].toLowerCase()} ${metrics[key]}`);
        return values.length ? `- ${snapshot.fetchedAt?.slice(0, 16).replace("T", " ") ?? "unknown time"}: ${values.join(", ")}` : null;
      })
      .filter(Boolean);
    return [
      describePost(result.post),
      result.post.metricsAt ? `Metrics collected ${formatDistanceToNow(new Date(result.post.metricsAt), { addSuffix: true })}.` : "",
      result.lastError ? `Blotato's last metrics fetch reported: ${result.lastError}` : "",
      history.length ? `History (oldest first):\n${history.join("\n")}` : "No history yet.",
    ]
      .filter(Boolean)
      .join("\n");
  },
});

export const ANALYTICS_TOOLS = [syncAnalyticsTool, getAnalyticsSummary, listPostPerformance, getPostAnalyticsTool];
