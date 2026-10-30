import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull, ne, or } from "drizzle-orm";
import { contentDrafts, db, posts, type ContentDraft, type Post } from "@/db";
import { toDraftView } from "@/lib/orchestration/deliverables";
import type { Scope } from "@/lib/orchestration/store";
import { POST_PLATFORMS, type PostPlatform, type PostView } from "@/lib/posts/shared";

// Reading and writing posts for one campaign. Every query is scoped to the campaign's owner.

export function toPostView(row: Post): PostView {
  return {
    id: row.id,
    source: row.source,
    draftId: row.draftId,
    title: row.title,
    caption: row.caption,
    hashtags: row.hashtags,
    platforms: row.platforms.filter((platform): platform is PostPlatform => (POST_PLATFORMS as readonly string[]).includes(platform)),
    media: row.media,
    status: row.status,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    timeZone: row.timeZone,
    accountIds: row.accountIds,
    results: row.platformResults,
    error: row.error,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPosts(scope: Scope) {
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.userId, scope.userId), eq(posts.campaignId, scope.campaignId)))
    .orderBy(desc(posts.id))
    .limit(200);
  return rows.map(toPostView);
}

// Posts with a time on the calendar (scheduled for, or published at), oldest first
export async function listCalendarPosts(scope: Scope) {
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.userId, scope.userId), eq(posts.campaignId, scope.campaignId), or(isNotNull(posts.scheduledAt), isNotNull(posts.publishedAt))))
    .orderBy(asc(posts.scheduledAt))
    .limit(1000);
  return rows.map(toPostView);
}

// Drafts kinds that make a post on their own (not ideas, scripts or bare hashtag sets)
const POSTABLE_KINDS: ContentDraft["kind"][] = ["post", "caption", "carousel"];

// The AI team's post drafts that haven't been scheduled as a post yet
export async function listUnscheduledDrafts(scope: Scope) {
  const [drafts, used] = await Promise.all([
    db
      .select()
      .from(contentDrafts)
      .where(
        and(
          eq(contentDrafts.userId, scope.userId),
          eq(contentDrafts.campaignId, scope.campaignId),
          inArray(contentDrafts.kind, POSTABLE_KINDS),
          ne(contentDrafts.status, "archived")
        )
      )
      .orderBy(desc(contentDrafts.id))
      .limit(100),
    db
      .select({ draftId: posts.draftId })
      .from(posts)
      .where(and(eq(posts.campaignId, scope.campaignId), isNotNull(posts.draftId))),
  ]);
  const scheduled = new Set(used.map((row) => row.draftId));
  return drafts.filter((draft) => !scheduled.has(draft.id)).map(toDraftView);
}

export async function getDraft(scope: Scope, draftId: number) {
  const [row] = await db
    .select()
    .from(contentDrafts)
    .where(and(eq(contentDrafts.id, draftId), eq(contentDrafts.userId, scope.userId), eq(contentDrafts.campaignId, scope.campaignId)));
  return row ? toDraftView(row) : null;
}

export async function getPost(scope: Scope, postId: number) {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.userId, scope.userId), eq(posts.campaignId, scope.campaignId)));
  return row ? toPostView(row) : null;
}

// Scheduled posts still to go out, soonest first
export async function listUpcomingPosts(campaignId: number, limit: number) {
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.campaignId, campaignId), eq(posts.status, "scheduled"), gt(posts.scheduledAt, new Date())))
    .orderBy(asc(posts.scheduledAt))
    .limit(limit);
  return rows.map(toPostView);
}

export async function countPostsByStatus(campaignId: number) {
  const rows = await db.select({ status: posts.status }).from(posts).where(eq(posts.campaignId, campaignId));
  const counts: Partial<Record<Post["status"], number>> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

export async function insertPost(values: typeof posts.$inferInsert) {
  const [row] = await db.insert(posts).values(values).returning();
  return toPostView(row);
}

// onlyIf: update only while the post is in one of these statuses (e.g. not once it's published)
export async function updatePost(scope: Scope, postId: number, values: Partial<typeof posts.$inferInsert>, onlyIf?: readonly Post["status"][]) {
  const [row] = await db
    .update(posts)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.userId, scope.userId),
        eq(posts.campaignId, scope.campaignId),
        onlyIf ? inArray(posts.status, [...onlyIf]) : undefined
      )
    )
    .returning();
  return row ? toPostView(row) : null;
}
