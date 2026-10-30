import "server-only";
import { BlotatoError } from "@/lib/blotato/client";
import { getPublishingAccounts } from "@/lib/blotato/store";
import { inngest } from "@/lib/inngest/client";
import type { Scope } from "@/lib/orchestration/store";
import { isCampaignMediaUrl } from "@/lib/posts/media";
import { cancelBlotatoSchedules, isDueSoon, scheduleInBlotato, toPublishEvent } from "@/lib/posts/publish";
import { checkPost, EDITABLE_STATUSES, isEditable, isTimeZone, type PlatformResults, PostInput, type PostView, utcToZonedParts, zonedTimeToUtc } from "@/lib/posts/shared";
import { getDraft, getPost, insertPost, updatePost } from "@/lib/posts/store";
import { normalizeHashtags } from "@/lib/social-platforms";

// Saving and scheduling posts, for the post editor (app/dashboard/posts/actions.ts) and the Scheduler
// Agent (lib/ai/tools/posts.ts) alike, so a post the agent schedules is on the Posts page, in the
// user's Blotato calendar, and tracked by Inngest like any other.

export type SavePostOutcome = { error: string; post?: undefined } | { error?: undefined; post: PostView };

function blotatoMessage(error: unknown, fallback: string) {
  if (error instanceof BlotatoError) return error.message;
  console.error(fallback, error);
  return `${fallback}. Please try again.`;
}

// Takes a post off the user's Blotato calendar before it's changed
async function cancelInBlotato(userId: string, post: Pick<PostView, "title" | "caption" | "hashtags" | "media" | "results" | "scheduledAt">) {
  try {
    await cancelBlotatoSchedules(userId, { ...post, scheduledAt: post.scheduledAt ? new Date(post.scheduledAt) : null });
    return null;
  } catch (error) {
    return `Couldn't cancel the post's current schedule in Blotato: ${blotatoMessage(error, "Blotato couldn't be reached")}`;
  }
}

// A post due within 15 minutes goes to Inngest now; later ones are sent by the 15-minute cron. A
// failed send is fine: the cron sends it on its next run.
async function dispatchIfDue(userId: string, post: PostView) {
  if (post.status !== "scheduled" || !post.scheduledAt || !isDueSoon(new Date(post.scheduledAt))) return;
  await inngest.send(toPublishEvent({ id: post.id, userId, scheduledAt: post.scheduledAt })).catch((error) => console.error("Dispatching the post failed", error));
}

// Saves a post. "schedule" needs a date and time in the future: it schedules the post in the user's
// Blotato calendar through Blotato's MCP tools (one Blotato post per platform), then stores it as
// scheduled; Blotato publishes it at that time and Inngest tracks the result. "draft" keeps it to
// finish another time. With postId it edits (and reschedules) that post, as long as it hasn't
// started publishing; its old Blotato schedule is cancelled first.
export async function savePostForScope(scope: Scope, input: PostInput, intent: "schedule" | "draft"): Promise<SavePostOutcome> {
  const parsed = PostInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some details aren't valid." };
  const post = parsed.data;
  const hashtags = normalizeHashtags(post.hashtags);
  const timeZone = isTimeZone(post.timeZone) ? post.timeZone : "UTC";

  if (post.media.some((item) => !isCampaignMediaUrl(item.url, scope.campaignId))) {
    return { error: "Some images aren't stored for this campaign. Upload them again." };
  }
  const existing = post.postId !== null ? await getPost(scope, post.postId) : null;
  if (post.postId !== null) {
    if (!existing) return { error: "That post no longer exists." };
    if (!isEditable(existing.status)) return { error: "This post has already gone out, so it can't be edited." };
  }
  // An edited post keeps its draft link even if the AI draft was deleted since
  const draftId = existing ? existing.draftId : post.draftId;
  if (!existing && draftId !== null && !(await getDraft(scope, draftId))) return { error: "That AI draft no longer exists." };

  let scheduledAt: Date | null = null;
  if (post.date && post.time) scheduledAt = zonedTimeToUtc(post.date, post.time, timeZone);

  // Only accounts connected in Blotato can be posted to; an account id must be one of the user's
  const connected = await getPublishingAccounts(scope.userId);
  const accountIds = Object.fromEntries(
    Object.entries(post.accountIds).filter(([platform, id]) => connected.byPlatform[platform as keyof typeof connected.byPlatform]?.some((account) => account.id === id))
  );

  if (intent === "schedule") {
    const missing = post.platforms.filter((platform) => !connected.platforms.includes(platform));
    if (missing.length) return { error: `Connect ${missing.join(", ")} in Blotato first (Settings → Integrations), or remove it from the post.` };
    const { errors } = checkPost({ ...post, hashtags });
    if (errors.length) return { error: errors[0] };
    if (!scheduledAt) return { error: "Pick a date and time to schedule the post." };
    if (scheduledAt.getTime() < Date.now() + 60_000) return { error: "Pick a time at least a minute from now." };
  }

  const values = {
    source: draftId !== null ? ("ai" as const) : ("manual" as const),
    draftId,
    title: post.title,
    caption: post.caption.trim(),
    hashtags,
    platforms: post.platforms,
    media: post.media,
    status: intent === "schedule" ? ("scheduled" as const) : ("draft" as const),
    scheduledAt,
    timeZone,
    accountIds,
  };

  // Blotato never keeps the old version: the edited post's schedule there goes first
  if (existing) {
    const cancelError = await cancelInBlotato(scope.userId, existing);
    if (cancelError) return { error: cancelError };
  }

  let platformResults: PlatformResults = {};
  if (intent === "schedule") {
    try {
      platformResults = await scheduleInBlotato(scope.userId, values, scheduledAt!);
    } catch (error) {
      const message = blotatoMessage(error, "The post couldn't be scheduled in Blotato");
      // Its old Blotato schedule is gone, so it can't stay scheduled here either
      if (existing?.status === "scheduled") {
        await updatePost(scope, existing.id, { status: "draft", platformResults: {}, error: message }, EDITABLE_STATUSES).catch(() => undefined);
      }
      return { error: `Blotato couldn't schedule the post: ${message}` };
    }
  }

  try {
    if (existing) {
      // Guarded on status so a post that started publishing meanwhile isn't changed under it
      const saved = await updatePost(scope, existing.id, { ...values, source: existing.source, platformResults, error: null }, EDITABLE_STATUSES);
      if (!saved) {
        await cancelInBlotato(scope.userId, { ...values, scheduledAt: scheduledAt?.toISOString() ?? null, results: platformResults });
        return { error: "This post has already gone out, so it can't be edited." };
      }
      await dispatchIfDue(scope.userId, saved);
      return { post: saved };
    }
    const saved = await insertPost({ ...values, platformResults, userId: scope.userId, campaignId: scope.campaignId });
    await dispatchIfDue(scope.userId, saved);
    return { post: saved };
  } catch (error) {
    console.error("Saving the post failed", error);
    // Don't leave a post in Blotato's calendar that the app doesn't know about
    if (scheduledAt && Object.keys(platformResults).length) {
      const cancelError = await cancelInBlotato(scope.userId, { ...values, scheduledAt: scheduledAt.toISOString(), results: platformResults });
      if (cancelError) console.error(cancelError);
    }
    return { error: "The post couldn't be saved. Please try again." };
  }
}

// Takes a scheduled post off the schedule, here and in the user's Blotato calendar (it stays on the
// Posts page as a draft)
export async function unschedulePostForScope(scope: Scope, postId: number): Promise<SavePostOutcome> {
  const existing = await getPost(scope, postId);
  if (!existing) return { error: "That post no longer exists." };
  if (!isEditable(existing.status)) return { error: "This post has already gone out, so it can't be unscheduled." };
  const cancelError = await cancelInBlotato(scope.userId, existing);
  if (cancelError) return { error: cancelError };
  const updated = await updatePost(scope, postId, { status: "draft", platformResults: {} }, EDITABLE_STATUSES);
  if (!updated) return { error: "This post has already gone out, so it can't be unscheduled." };
  return { post: updated };
}

// Moves a post to another moment (the calendar's drag and drop). It keeps its own time zone, so the
// moment becomes a wall-clock date and time there. A scheduled post is rescheduled in Blotato like any
// edit; a draft just gets the new date.
export async function reschedulePostForScope(scope: Scope, postId: number, at: Date): Promise<SavePostOutcome> {
  if (Number.isNaN(at.getTime())) return { error: "That time isn't valid." };
  const existing = await getPost(scope, postId);
  if (!existing) return { error: "That post no longer exists." };
  if (!isEditable(existing.status)) return { error: "This post has already gone out, so it can't be moved." };
  const { date, time } = utcToZonedParts(at, existing.timeZone);
  const input: PostInput = {
    title: existing.title,
    caption: existing.caption,
    hashtags: existing.hashtags,
    platforms: existing.platforms,
    media: existing.media,
    draftId: existing.draftId,
    postId: existing.id,
    date,
    time,
    timeZone: existing.timeZone,
    accountIds: existing.accountIds,
  };
  return savePostForScope(scope, input, existing.status === "scheduled" ? "schedule" : "draft");
}
