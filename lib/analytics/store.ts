import "server-only";
import { and, desc, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { analyticsSyncs, db, postAnalytics, posts, userIntegrations, type PostAnalytics } from "@/db";
import { BlotatoError } from "@/lib/blotato/client";
import { getPostAnalytics, listPublishedPosts, withBlotatoMcp, type BlotatoPublishedPost } from "@/lib/blotato/mcp";
import { getBlotatoApiKey } from "@/lib/blotato/store";
import { readMetrics, SYNC_WINDOW_DAYS, type AnalyticsPost, type SyncState } from "@/lib/analytics/shared";
import { postCaption, type PlatformResult } from "@/lib/posts/shared";

// Post analytics: synced from the user's Blotato account (blotato_list_posts, which carries each
// published post's latest metrics) into post_analytics, then read from there by the Analytics page
// and the Analytics Agent. Each Blotato post is linked to the app's post (and so its campaign) when
// it went out from the Posts page. Nothing here returns the API key.

const DAY_MS = 24 * 60 * 60 * 1000;
// How far a Blotato post's time may be from the app post's time and still be the same post
const MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;
const HISTORY_LIMIT = 30;

type AppPost = {
  id: number;
  campaignId: number;
  platforms: string[];
  platformResults: Partial<Record<string, PlatformResult>>;
  caption: string;
  hashtags: string[];
  scheduledAt: Date | null;
  publishedAt: Date | null;
};

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^(www|m)\./, "")}${parsed.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function normalizeText(text: string | null) {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Finds the app post each Blotato post came from: by its public URL (recorded once it published),
// else by platform, account, time and text. Each app post's platform is matched at most once.
function postMatcher(appPosts: AppPost[]) {
  const byUrl = new Map<string, { post: AppPost; platform: string }>();
  for (const post of appPosts) {
    for (const [platform, result] of Object.entries(post.platformResults)) {
      if (result?.url) byUrl.set(normalizeUrl(result.url), { post, platform });
    }
  }
  const taken = new Set<string>();
  const claim = (post: AppPost, platform: string) => {
    taken.add(`${post.id}:${platform}`);
    return post;
  };

  return (item: BlotatoPublishedPost): AppPost | null => {
    const hit = item.postUrl ? byUrl.get(normalizeUrl(item.postUrl)) : undefined;
    if (hit && !taken.has(`${hit.post.id}:${hit.platform}`)) return claim(hit.post, hit.platform);

    const at = Date.parse(item.postTime);
    const text = normalizeText(item.text);
    const candidates = appPosts.filter((post) => {
      if (!post.platforms.includes(item.platform) || taken.has(`${post.id}:${item.platform}`)) return false;
      const accountId = post.platformResults[item.platform]?.accountId;
      if (accountId && item.accountId && accountId !== item.accountId) return false;
      const when = [post.scheduledAt, post.publishedAt].filter((value): value is Date => !!value);
      return when.some((value) => Math.abs(value.getTime() - at) <= MATCH_WINDOW_MS);
    });
    const byText = text ? candidates.find((post) => normalizeText(postCaption(post)) === text) : undefined;
    const match = byText ?? (candidates.length === 1 && !text ? candidates[0] : undefined);
    return match ? claim(match, item.platform) : null;
  };
}

async function listAppPosts(userId: string, since: Date) {
  return db
    .select({
      id: posts.id,
      campaignId: posts.campaignId,
      platforms: posts.platforms,
      platformResults: posts.platformResults,
      caption: posts.caption,
      hashtags: posts.hashtags,
      scheduledAt: posts.scheduledAt,
      publishedAt: posts.publishedAt,
    })
    .from(posts)
    .where(and(eq(posts.userId, userId), or(gte(posts.scheduledAt, since), gte(posts.publishedAt, since))))
    .limit(5000);
}

function toValues(userId: string, item: BlotatoPublishedPost, match: AppPost | null, now: Date) {
  const metrics = readMetrics(item.metrics);
  return {
    userId,
    blotatoPostId: item.id,
    campaignId: match?.campaignId ?? null,
    postId: match?.id ?? null,
    accountId: item.accountId,
    platform: item.platform,
    state: item.state,
    postedAt: new Date(item.postTime),
    text: item.text,
    postUrl: item.postUrl,
    error: item.state === "failed" ? (item.errorMessage ?? "Blotato couldn't publish it.") : null,
    ...metrics,
    rawMetrics: item.metrics,
    metricsHistory: item.history.slice(-HISTORY_LIMIT),
    metricsFetchedAt: item.metricsAt ? new Date(item.metricsAt) : null,
    syncedAt: now,
  };
}

async function recordSync(userId: string, result: { synced: number } | { error: string }) {
  const now = new Date();
  const values = "error" in result ? { lastAttemptAt: now, lastError: result.error.slice(0, 500) } : { lastAttemptAt: now, lastSyncedAt: now, lastError: null, postsSynced: result.synced };
  await db.insert(analyticsSyncs).values({ userId, ...values }).onConflictDoUpdate({ target: analyticsSyncs.userId, set: values });
}

export type SyncResult = { synced: number; linked: number; error?: undefined } | { error: string; synced?: undefined; linked?: undefined };

// Pulls the user's published and failed posts of the last year, with their metrics, from Blotato into
// post_analytics. A post linked to the app's post keeps that link even if a later sync can't match it.
export async function syncAnalytics(userId: string): Promise<SyncResult> {
  const apiKey = await getBlotatoApiKey(userId);
  if (!apiKey) return { error: "Blotato isn't connected. Add your API key in Settings → Integrations." };

  const now = new Date();
  const since = new Date(now.getTime() - SYNC_WINDOW_DAYS * DAY_MS);
  let items: BlotatoPublishedPost[];
  try {
    items = await withBlotatoMcp(apiKey, (server) => listPublishedPosts(server, { since: since.toISOString(), until: now.toISOString() }));
  } catch (error) {
    const message = error instanceof BlotatoError ? error.message : `Couldn't sync analytics: ${(error as Error).message}`;
    await recordSync(userId, { error: message });
    return { error: message };
  }

  const match = postMatcher(await listAppPosts(userId, new Date(since.getTime() - DAY_MS)));
  const rows = items.map((item) => toValues(userId, item, match(item), now));
  for (let i = 0; i < rows.length; i += 200) {
    await db
      .insert(postAnalytics)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: [postAnalytics.userId, postAnalytics.blotatoPostId],
        set: {
          campaignId: sql`coalesce(excluded.campaign_id, ${postAnalytics.campaignId})`,
          postId: sql`coalesce(excluded.post_id, ${postAnalytics.postId})`,
          accountId: sql`excluded.account_id`,
          platform: sql`excluded.platform`,
          state: sql`excluded.state`,
          postedAt: sql`excluded.posted_at`,
          text: sql`excluded.text`,
          postUrl: sql`excluded.post_url`,
          error: sql`excluded.error`,
          // A sync that came back without metrics keeps the ones already collected
          views: sql`coalesce(excluded.views, ${postAnalytics.views})`,
          likes: sql`coalesce(excluded.likes, ${postAnalytics.likes})`,
          comments: sql`coalesce(excluded.comments, ${postAnalytics.comments})`,
          shares: sql`coalesce(excluded.shares, ${postAnalytics.shares})`,
          saves: sql`coalesce(excluded.saves, ${postAnalytics.saves})`,
          reach: sql`coalesce(excluded.reach, ${postAnalytics.reach})`,
          impressions: sql`coalesce(excluded.impressions, ${postAnalytics.impressions})`,
          rawMetrics: sql`coalesce(excluded.raw_metrics, ${postAnalytics.rawMetrics})`,
          metricsHistory: sql`case when jsonb_array_length(excluded.metrics_history) > 0 then excluded.metrics_history else ${postAnalytics.metricsHistory} end`,
          metricsFetchedAt: sql`coalesce(excluded.metrics_fetched_at, ${postAnalytics.metricsFetchedAt})`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }

  const result = { synced: rows.length, linked: rows.filter((row) => row.postId !== null).length };
  await recordSync(userId, result);
  return result;
}

// Fetches one published post's metrics again, straight from Blotato, and saves them
export async function refreshPostAnalytics(userId: string, blotatoPostId: string) {
  const [row] = await db
    .select()
    .from(postAnalytics)
    .where(and(eq(postAnalytics.userId, userId), eq(postAnalytics.blotatoPostId, blotatoPostId)));
  if (!row) return { error: `There's no synced post ${blotatoPostId}. Call sync_analytics, then list_post_performance for the ids.` } as const;
  const apiKey = await getBlotatoApiKey(userId);
  if (!apiKey) return { error: "Blotato isn't connected. The user adds their API key in Settings → Integrations." } as const;

  const live = await withBlotatoMcp(apiKey, (server) => getPostAnalytics(server, blotatoPostId));
  if (!live.metrics) return { post: toAnalyticsPost(row, null), history: row.metricsHistory, lastError: live.lastError } as const;
  const [updated] = await db
    .update(postAnalytics)
    .set({
      ...readMetrics(live.metrics),
      rawMetrics: live.metrics,
      metricsHistory: live.history.length ? live.history.slice(-HISTORY_LIMIT) : row.metricsHistory,
      metricsFetchedAt: live.metricsAt ? new Date(live.metricsAt) : row.metricsFetchedAt,
      syncedAt: new Date(),
    })
    .where(eq(postAnalytics.id, row.id))
    .returning();
  return { post: toAnalyticsPost(updated, null), history: updated.metricsHistory, lastError: live.lastError } as const;
}

function toAnalyticsPost(row: PostAnalytics, app: { title: string; source: "manual" | "ai" } | null): AnalyticsPost {
  return {
    id: row.blotatoPostId,
    platform: row.platform,
    state: row.state,
    postedAt: row.postedAt.toISOString(),
    text: row.text,
    postUrl: row.postUrl,
    error: row.error,
    campaignId: row.campaignId,
    postId: row.postId,
    title: app?.title ?? null,
    source: app?.source ?? null,
    metrics: { views: row.views, likes: row.likes, comments: row.comments, shares: row.shares, saves: row.saves, reach: row.reach, impressions: row.impressions },
    metricsAt: row.metricsFetchedAt?.toISOString() ?? null,
  };
}

// The user's synced posts of the last year, newest first, with their app post's title and source
export async function listAnalyticsPosts(userId: string, options: { campaignId?: number; sinceDays?: number } = {}) {
  const since = new Date(Date.now() - (options.sinceDays ?? SYNC_WINDOW_DAYS) * DAY_MS);
  const rows = await db
    .select({ row: postAnalytics, title: posts.title, source: posts.source })
    .from(postAnalytics)
    .leftJoin(posts, eq(posts.id, postAnalytics.postId))
    .where(
      and(
        eq(postAnalytics.userId, userId),
        gte(postAnalytics.postedAt, since),
        options.campaignId !== undefined ? eq(postAnalytics.campaignId, options.campaignId) : undefined
      )
    )
    .orderBy(desc(postAnalytics.postedAt))
    .limit(5000);
  return rows.map(({ row, title, source }) => toAnalyticsPost(row, title && source ? { title, source } : null));
}

export async function getSyncState(userId: string): Promise<SyncState> {
  const [[integration], [sync]] = await Promise.all([
    db
      .select({ id: userIntegrations.id })
      .from(userIntegrations)
      .where(and(eq(userIntegrations.userId, userId), eq(userIntegrations.provider, "blotato"))),
    db.select().from(analyticsSyncs).where(eq(analyticsSyncs.userId, userId)),
  ]);
  return {
    connected: !!integration,
    lastSyncedAt: sync?.lastSyncedAt?.toISOString() ?? null,
    lastAttemptAt: sync?.lastAttemptAt.toISOString() ?? null,
    lastError: sync?.lastError ?? null,
  };
}

// Everyone with Blotato connected, for the scheduled sync
export async function listAnalyticsUsers() {
  const rows = await db
    .select({ userId: userIntegrations.userId })
    .from(userIntegrations)
    .where(and(eq(userIntegrations.provider, "blotato"), isNotNull(userIntegrations.apiKeyEncrypted)));
  return rows.map((row) => row.userId);
}
