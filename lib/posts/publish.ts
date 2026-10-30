import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, posts } from "@/db";
import { BlotatoError, type BlotatoPostInput } from "@/lib/blotato/client";
import { createPost, deleteSchedule, getPostStatus, listSchedules, withBlotatoMcp, type BlotatoMcp, type BlotatoSchedule } from "@/lib/blotato/mcp";
import { accountsByPlatform } from "@/lib/blotato/shared";
import { getBlotatoApiKey, getBlotatoIntegration } from "@/lib/blotato/store";
import { mediaForPlatform, postCaption, type PlatformResult, type PlatformResults, type PostMedia, type PostPlatform } from "@/lib/posts/shared";

// Scheduling posts in the user's own Blotato calendar, through Blotato's MCP tools. Saving a scheduled
// post creates one Blotato post per platform with its scheduledTime (scheduleInBlotato); editing or
// unscheduling it cancels those first (cancelBlotatoSchedules). Blotato publishes them at their time.
// The publish-scheduled-post Inngest function (lib/inngest/functions.ts) then tracks them: claim the
// post at its time, poll Blotato until each platform is published or failed, and settle the post's
// status. Nothing here returns the API key, so it never ends up in Inngest's step history.

// Posts due within this window are handed to Inngest (when saved, and by the 15-minute cron)
export const POST_DISPATCH_WINDOW_MS = 15 * 60 * 1000;
// Posts that were due this long ago and still haven't gone out (say the server was down) still go
const MAX_LATE_MS = 24 * 60 * 60 * 1000;

export type PublishEvent = { postId: number; userId: string; scheduledAt: string; dispatchId: string };

export function toPublishEvent(post: { id: number; userId: string; scheduledAt: Date | string }) {
  const scheduledAt = new Date(post.scheduledAt).toISOString();
  const data: PublishEvent = { postId: post.id, userId: post.userId, scheduledAt, dispatchId: `post-${post.id}-${Date.parse(scheduledAt)}` };
  // The event id dedupes repeat sends of the same dispatch (the cron sends each due post every run)
  return { name: "post/publish" as const, id: data.dispatchId, data };
}

export function isDueSoon(scheduledAt: Date) {
  return scheduledAt.getTime() <= Date.now() + POST_DISPATCH_WINDOW_MS;
}

// Scheduled posts due in the next 15 minutes (or overdue by less than a day)
export async function listDuePosts() {
  const now = Date.now();
  const rows = await db
    .select({ id: posts.id, userId: posts.userId, scheduledAt: posts.scheduledAt })
    .from(posts)
    .where(
      and(
        eq(posts.status, "scheduled"),
        lte(posts.scheduledAt, new Date(now + POST_DISPATCH_WINDOW_MS)),
        gte(posts.scheduledAt, new Date(now - MAX_LATE_MS))
      )
    )
    .limit(500);
  return rows.filter((row): row is typeof row & { scheduledAt: Date } => row.scheduledAt !== null).map(toPublishEvent);
}

// Moves the post to publishing, as long as it's still scheduled for this time (an edited, rescheduled
// or unscheduled post leaves its old dispatch with nothing to do). Keeps its Blotato schedules to
// track. Returns its platforms, or null.
export async function claimPostForPublishing(event: PublishEvent) {
  const [row] = await db
    .update(posts)
    .set({ status: "publishing", error: null, updatedAt: new Date() })
    .where(and(eq(posts.id, event.postId), eq(posts.status, "scheduled"), eq(posts.scheduledAt, new Date(event.scheduledAt))))
    .returning({ platforms: posts.platforms });
  return row ? (row.platforms as PostPlatform[]) : null;
}

async function getPostRow(postId: number) {
  const [row] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!row) throw new Error(`Post ${postId} no longer exists.`);
  return row;
}

async function saveResult(postId: number, platform: PostPlatform, result: PlatformResult) {
  await db
    .update(posts)
    .set({ platformResults: sql`${posts.platformResults} || ${JSON.stringify({ [platform]: result })}::jsonb`, updatedAt: new Date() })
    .where(eq(posts.id, postId));
}

const AI_ORIGINS = new Set(["generated", "edited", "agent"]);

// What goes out on each platform
type PostContent = { title: string; caption: string; hashtags: string[]; media: PostMedia[] };

function buildBlotatoPost(post: PostContent, platform: PostPlatform, accountId: string): BlotatoPostInput {
  const media = mediaForPlatform(platform, post.media);
  const mediaUrls = media.map((item) => item.url);
  const text = postCaption(post);
  const aiGenerated = media.some((item) => AI_ORIGINS.has(item.origin));
  if (platform === "youtube") {
    return {
      accountId,
      platform,
      text,
      mediaUrls,
      target: { targetType: "youtube", title: post.title.slice(0, 100), privacyStatus: "public", shouldNotifySubscribers: true, containsSyntheticMedia: aiGenerated },
    };
  }
  if (platform === "tiktok") {
    const photos = !media.some((item) => item.mimeType?.startsWith("video/"));
    return {
      accountId,
      platform,
      text,
      mediaUrls,
      target: {
        targetType: "tiktok",
        privacyLevel: "PUBLIC_TO_EVERYONE",
        disabledComments: false,
        disabledDuet: false,
        disabledStitch: false,
        isBrandedContent: false,
        isYourBrand: false,
        isAiGenerated: aiGenerated,
        ...(photos ? { title: post.title.slice(0, 90) } : {}),
      },
    };
  }
  return { accountId, platform, text, mediaUrls, target: { targetType: "instagram" } };
}

// The account the post goes to on a platform: the one picked in the editor if it's still connected,
// otherwise the first connected one
async function accountPicker(userId: string) {
  const integration = await getBlotatoIntegration(userId);
  const byPlatform = accountsByPlatform(integration.accounts);
  return (platform: PostPlatform, chosen: string | undefined) => {
    const accounts = byPlatform[platform] ?? [];
    return chosen && accounts.some((account) => account.id === chosen) ? chosen : (accounts[0]?.id ?? null);
  };
}

// The Blotato schedule a created post became (create only returns a submission id): same account,
// platform, time and, when it can, text. ids already matched to another platform are skipped.
function findSchedule(schedules: BlotatoSchedule[], taken: Set<string>, input: BlotatoPostInput, scheduledAt: Date) {
  const candidates = schedules.filter(
    (schedule) =>
      !taken.has(schedule.id) &&
      schedule.accountId === input.accountId &&
      (schedule.platform === null || schedule.platform === input.platform) &&
      Date.parse(schedule.scheduledAt) === scheduledAt.getTime()
  );
  const match = candidates.find((schedule) => schedule.text === input.text) ?? candidates[0];
  if (match) taken.add(match.id);
  return match?.id ?? null;
}

// Cancels the given Blotato posts' schedules, looking up the ids that weren't recorded
async function deleteSchedules(server: BlotatoMcp, entries: { scheduleId: string | null; input: BlotatoPostInput | null }[], scheduledAt: Date | null) {
  const missing = entries.filter((entry) => !entry.scheduleId && entry.input);
  const taken = new Set(entries.flatMap((entry) => (entry.scheduleId ? [entry.scheduleId] : [])));
  const schedules = missing.length && scheduledAt ? await listSchedules(server) : [];
  for (const entry of entries) {
    const id = entry.scheduleId ?? (entry.input && scheduledAt ? findSchedule(schedules, taken, entry.input, scheduledAt) : null);
    if (id) await deleteSchedule(server, id);
  }
}

// Schedules the post in the user's Blotato calendar for scheduledAt: one Blotato post per platform.
// All or nothing: if a platform can't be scheduled, the ones already scheduled are cancelled and the
// error is thrown (a BlotatoError, with a message for the user).
export async function scheduleInBlotato(
  userId: string,
  post: PostContent & { platforms: PostPlatform[]; accountIds: Partial<Record<PostPlatform, string>> },
  scheduledAt: Date
): Promise<PlatformResults> {
  const apiKey = await getBlotatoApiKey(userId);
  if (!apiKey) throw new BlotatoError("Blotato isn't connected. Add your API key in Settings → Integrations.", 400);
  const pickAccount = await accountPicker(userId);
  const inputs = post.platforms.map((platform) => {
    const accountId = pickAccount(platform, post.accountIds[platform]);
    if (!accountId) throw new BlotatoError(`No ${platform} account is connected in Blotato. Connect one, then refresh your accounts.`, 400);
    return [platform, buildBlotatoPost(post, platform, accountId)] as const;
  });

  return withBlotatoMcp(apiKey, async (server) => {
    const created: { platform: PostPlatform; input: BlotatoPostInput; submissionId: string }[] = [];
    try {
      for (const [platform, input] of inputs) {
        const { submissionId } = await createPost(server, input, scheduledAt.toISOString());
        created.push({ platform, input, submissionId });
      }
    } catch (error) {
      await deleteSchedules(
        server,
        created.map((entry) => ({ scheduleId: null, input: entry.input })),
        scheduledAt
      ).catch((undoError) => console.error("Cancelling the partly scheduled post in Blotato failed", undoError));
      const message = (error as Error).message;
      throw new BlotatoError(created.length ? `Couldn't schedule it on ${inputs[created.length][0]}: ${message}` : message, error instanceof BlotatoError ? error.status : 0);
    }

    // Record each schedule's id, so an edit or unschedule can cancel it without a lookup
    const schedules = await listSchedules(server).catch((error) => {
      console.error("Listing Blotato schedules failed", error);
      return [];
    });
    const taken = new Set<string>();
    const results: PlatformResults = {};
    for (const { platform, input, submissionId } of created) {
      results[platform] = { status: "scheduled", accountId: input.accountId, submissionId, scheduleId: findSchedule(schedules, taken, input, scheduledAt) };
    }
    return results;
  });
}

// Takes the post off the user's Blotato calendar (before it's edited, rescheduled or unscheduled).
// Throws a BlotatoError when Blotato can't be reached or the key is gone, so the post isn't left
// scheduled in Blotato while the app shows it as changed.
export async function cancelBlotatoSchedules(userId: string, post: PostContent & { results: PlatformResults; scheduledAt: Date | null }) {
  const scheduled = (Object.entries(post.results) as [PostPlatform, PlatformResult][]).filter(([, result]) => result.status === "scheduled");
  if (scheduled.length === 0) return;
  const apiKey = await getBlotatoApiKey(userId);
  if (!apiKey) throw new BlotatoError("Blotato isn't connected, so this post's schedule there can't be cancelled. Reconnect Blotato in Settings → Integrations.", 400);
  const entries = scheduled.map(([platform, result]) => ({
    scheduleId: result.scheduleId ?? null,
    input: result.accountId ? buildBlotatoPost(post, platform, result.accountId) : null,
  }));
  await withBlotatoMcp(apiKey, (server) => deleteSchedules(server, entries, post.scheduledAt));
}

// At the post's time: its Blotato post on this platform is already scheduled (the usual case), so
// there's nothing to send. A post that wasn't scheduled in Blotato (saved before posts were) is
// published now through Blotato instead. Network, rate-limit and server errors are thrown so Inngest
// retries the step; on the last attempt, or for anything retrying won't fix, the platform is
// recorded as failed and the other platforms still go out.
export async function submitToPlatform(postId: number, platform: PostPlatform, finalAttempt: boolean): Promise<PlatformResult> {
  const post = await getPostRow(postId);
  const existing = post.platformResults[platform];
  // Scheduled in Blotato, or a retried step whose submission already went through
  if (existing?.submissionId) return existing;

  const fail = async (accountId: string | null, error: string) => {
    const result: PlatformResult = { status: "failed", accountId, error };
    await saveResult(postId, platform, result);
    return result;
  };

  const apiKey = await getBlotatoApiKey(post.userId);
  if (!apiKey) return fail(null, "Blotato isn't connected. Add your API key in Settings → Integrations.");
  const accountId = (await accountPicker(post.userId))(platform, post.accountIds[platform]);
  if (!accountId) return fail(null, `No ${platform} account is connected in Blotato. Connect one, then refresh your accounts.`);

  try {
    const { submissionId } = await withBlotatoMcp(apiKey, (server) => createPost(server, buildBlotatoPost(post, platform, accountId)));
    const result: PlatformResult = { status: "in-progress", accountId, submissionId };
    await saveResult(postId, platform, result);
    return result;
  } catch (error) {
    const retryable = error instanceof BlotatoError && (error.status === 0 || error.status === 429 || error.status >= 500);
    if (retryable && !finalAttempt) throw error;
    return fail(accountId, (error as Error).message);
  }
}

// Asks Blotato how each platform's post is doing. Returns how many are still waiting (scheduled in
// Blotato, or processing).
export async function checkSubmissions(postId: number) {
  const post = await getPostRow(postId);
  const pending = (Object.entries(post.platformResults) as [PostPlatform, PlatformResult][]).filter(
    ([, result]) => (result.status === "scheduled" || result.status === "in-progress") && result.submissionId
  );
  if (pending.length === 0) return 0;
  const apiKey = await getBlotatoApiKey(post.userId);
  if (!apiKey) return pending.length;

  let stillPending = 0;
  await withBlotatoMcp(apiKey, async (server) => {
    for (const [platform, result] of pending) {
      try {
        const status = await getPostStatus(server, result.submissionId!);
        if (status.status === "published") await saveResult(postId, platform, { ...result, status: "published", url: status.publicUrl ?? null });
        else if (status.status === "failed") await saveResult(postId, platform, { ...result, status: "failed", error: status.errorMessage ?? "Blotato couldn't publish it." });
        else {
          if (status.status === "in-progress" && result.status !== "in-progress") await saveResult(postId, platform, { ...result, status: "in-progress" });
          stillPending++;
        }
      } catch {
        // A failed status check isn't a failed post: check again next time
        stillPending++;
      }
    }
  }).catch(() => {
    stillPending = pending.length;
  });
  return stillPending;
}

// Settles the post: published if any platform went out, failed if none did
export async function finishPost(postId: number) {
  const post = await getPostRow(postId);
  const results = Object.entries(post.platformResults) as [PostPlatform, PlatformResult][];
  const published = results.filter(([, result]) => result.status === "published");
  const problems = results
    .filter(([, result]) => result.status !== "published")
    .map(([platform, result]) =>
      result.status === "failed" ? `${platform}: ${result.error ?? "failed"}` : `${platform}: still processing in Blotato, check your Blotato dashboard`
    );
  const status =
    published.length > 0 || results.some(([, result]) => result.status === "in-progress" || result.status === "scheduled") ? "published" : "failed";
  await db
    .update(posts)
    .set({ status, error: problems.length ? problems.join(" · ") : null, publishedAt: status === "published" ? new Date() : null, updatedAt: new Date() })
    .where(eq(posts.id, postId));
  return { status, published: published.length, problems: problems.length };
}

// The publish run itself failed (retries used up): the post shows as failed with why
export async function failPost(postId: number, message: string) {
  await db
    .update(posts)
    .set({ status: "failed", error: message.slice(0, 1000), updatedAt: new Date() })
    .where(and(eq(posts.id, postId), eq(posts.status, "publishing")));
}
