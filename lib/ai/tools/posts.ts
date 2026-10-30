import "server-only";
import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import type { WorkerContext } from "@/lib/ai/tools/context";
import { checkpointDue, setStep } from "@/lib/ai/tools/runtime";
import { accountLabel } from "@/lib/blotato/shared";
import { getBlotatoIntegration, getPublishingAccounts } from "@/lib/blotato/store";
import { findCampaignMedia } from "@/lib/orchestration/deliverables";
import { savePostForScope, unschedulePostForScope } from "@/lib/posts/save";
import { formatInZone, isTimeZone, POST_PLATFORMS, type PostMedia, type PostPlatform, type PostView, utcToZonedParts } from "@/lib/posts/shared";
import { getDraft, getPost, listPosts } from "@/lib/posts/store";
import { PLATFORM_RULES } from "@/lib/social-platforms";

// The Scheduler Agent's publishing tools. A post it schedules is saved like one from the post editor
// (lib/posts/save.ts): it's on the Posts page, scheduled in the user's Blotato calendar (which
// publishes it at its time), and tracked by Inngest until it's out.

// "Post now" goes out this soon: scheduling needs a time at least a minute ahead
const POST_NOW_DELAY_MS = 3 * 60 * 1000;

function describePost(post: PostView) {
  const when = post.scheduledAt ? formatInZone(post.scheduledAt, post.timeZone) : "no time set";
  const results = Object.entries(post.results)
    .map(([platform, result]) => `${PLATFORM_RULES[platform as PostPlatform].name}: ${result!.status}${result!.url ? ` ${result!.url}` : ""}${result!.error ? ` (${result!.error})` : ""}`)
    .join("; ");
  return [
    `Post #${post.id} "${post.title}" [${post.status}] on ${post.platforms.map((platform) => PLATFORM_RULES[platform].name).join(", ")}, ${when}`,
    post.draftId ? `from draft #${post.draftId}` : "",
    results ? `Blotato: ${results}` : "",
    post.error ? `Problem: ${post.error}` : "",
  ]
    .filter(Boolean)
    .join(". ");
}

export const listPublishingAccounts = tool({
  name: "list_publishing_accounts",
  description: "List the social accounts the user connected through Blotato that posts can go to (Instagram, TikTok, YouTube), with their account ids.",
  parameters: z.object({}),
  execute: async (_input, runContext?: RunContext<WorkerContext>) => {
    const { scope } = runContext!.context;
    const integration = await getBlotatoIntegration(scope.userId);
    if (!integration.connected) {
      return "Blotato isn't connected, so nothing can be scheduled. The user connects it in Settings → Integrations.";
    }
    const { platforms, byPlatform } = await getPublishingAccounts(scope.userId);
    if (!platforms.length) {
      return "No Instagram, TikTok or YouTube account is connected in Blotato. The user connects them in Blotato, then clicks \"Refresh accounts\" on the Accounts page.";
    }
    return platforms
      .map((platform) => `${PLATFORM_RULES[platform].name}: ${byPlatform[platform]!.map((account) => `${accountLabel(account)} (account_id ${account.id})`).join(", ")}`)
      .join("\n");
  },
});

export const listPostsTool = tool({
  name: "list_posts",
  description: "List the campaign's posts on the Posts page (newest first): drafts, scheduled, publishing, published and failed, with their ids, times and Blotato status. Use it before scheduling, so a post isn't scheduled twice.",
  parameters: z.object({
    status: z.enum(["draft", "scheduled", "publishing", "published", "failed", "cancelled"]).nullable().describe("Only posts with this status, or null for all"),
  }),
  execute: async ({ status }, runContext?: RunContext<WorkerContext>) => {
    const { scope } = runContext!.context;
    const posts = (await listPosts(scope)).filter((post) => !status || post.status === status).slice(0, 30);
    return posts.length ? posts.map(describePost).join("\n") : `There are no ${status ? `${status} ` : ""}posts yet.`;
  },
});

const AccountChoice = z.object({ platform: z.enum(POST_PLATFORMS), account_id: z.string() });

export const schedulePost = tool({
  name: "schedule_post",
  description:
    "Schedule a post: it's added to the Posts page and scheduled in the user's Blotato calendar, which publishes it at that time. Start from a team draft (draft_id) or give the content; with post_id it changes or reschedules that post instead. Fields left null come from the draft or the post being changed.",
  parameters: z.object({
    post_id: z.number().int().nullable().describe("A post on the Posts page to change or reschedule; null for a new post"),
    draft_id: z.number().int().nullable().describe("The team draft to post (its title, caption, hashtags and media are used), or null"),
    title: z.string().max(200).nullable().describe("The post's title (YouTube's video title); null to keep the draft's or post's"),
    caption: z.string().max(5000).nullable().describe("The caption without hashtags, exactly as it should go out; null to keep the draft's or post's"),
    hashtags: z.array(z.string().max(80)).max(60).nullable().describe("null to keep the draft's or post's"),
    media_urls: z.array(z.string()).max(10).nullable().describe("Images or a video, in order: URLs made for this campaign (from drafts or the team's work); null to keep the draft's or post's"),
    platforms: z.array(z.enum(POST_PLATFORMS)).nullable().describe("Where it goes out; null for the draft's platform or the post's platforms"),
    accounts: z.array(AccountChoice).nullable().describe("Which account to use per platform (from list_publishing_accounts); null for the first connected account of each"),
    post_now: z.boolean().describe("true to publish right away (it goes out in a few minutes); then date and time are ignored"),
    date: z.string().nullable().describe("Local date, YYYY-MM-DD, in time_zone"),
    time: z.string().nullable().describe("Local time, HH:MM (24-hour), in time_zone"),
    time_zone: z.string().describe("IANA time zone of date and time, e.g. \"Asia/Kolkata\""),
  }),
  needsApproval: checkpointDue,
  execute: async (input, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    const { scope } = context;
    if (!isTimeZone(input.time_zone)) return `"${input.time_zone}" isn't a time zone. Use an IANA name like "Asia/Kolkata".`;

    const existing = input.post_id !== null ? await getPost(scope, input.post_id) : null;
    if (input.post_id !== null && !existing) return `There's no post #${input.post_id}. Check list_posts.`;
    const draft = input.draft_id !== null ? await getDraft(scope, input.draft_id) : null;
    if (input.draft_id !== null && !draft) return `There's no draft #${input.draft_id} in this campaign.`;

    // A draft is posted once: scheduling it again (a retried or revised task) changes its post
    if (!existing && draft) {
      const used = (await listPosts(scope)).find((post) => post.draftId === draft.id && post.status !== "cancelled");
      if (used) return `Draft #${draft.id} is already post #${used.id} (${used.status}). To change its time or content, call schedule_post again with post_id ${used.id}.`;
    }

    // The content: what's given, else the draft's, else the post's
    const title = input.title?.trim() || draft?.title || existing?.title;
    if (!title) return "Give the post a title (or a draft_id).";
    const caption = input.caption ?? (draft ? [draft.hook, draft.body, draft.cta].filter((part) => part?.trim()).join("\n\n") : existing?.caption) ?? "";
    const hashtags = input.hashtags ?? draft?.hashtags ?? existing?.hashtags ?? [];
    const draftPlatform = draft && (POST_PLATFORMS as readonly string[]).includes(draft.platform) ? [draft.platform as PostPlatform] : null;
    const platforms = input.platforms ?? draftPlatform ?? existing?.platforms;
    if (!platforms?.length) return "Say which platforms the post goes to.";

    let media: PostMedia[];
    const known: PostMedia[] = [
      ...(draft?.media ?? []).map((item) => ({ url: item.url, fileId: null, name: item.name, mimeType: item.mimeType, origin: "agent" as const })),
      ...(existing?.media ?? []),
    ];
    if (input.media_urls) {
      const urls = [...new Set(input.media_urls.map((url) => url.trim()).filter(Boolean))];
      const found = await findCampaignMedia(scope.campaignId, urls.filter((url) => !known.some((item) => item.url === url)));
      const missing: string[] = [];
      media = urls.flatMap((url) => {
        const item = known.find((entry) => entry.url === url) ?? found.find((row) => row.url === url);
        if (!item) {
          missing.push(url);
          return [];
        }
        return [{ url, fileId: null, name: item.name, mimeType: item.mimeType, origin: "agent" as const }];
      });
      if (missing.length) return `These media URLs weren't made for this campaign: ${missing.join(", ")}. Use the exact URLs from the drafts or your teammates' work.`;
    } else {
      media = draft ? known.filter((item) => draft.media.some((entry) => entry.url === item.url)) : (existing?.media ?? []);
    }

    let { date, time } = input;
    if (input.post_now) ({ date, time } = utcToZonedParts(new Date(Date.now() + POST_NOW_DELAY_MS), input.time_zone));
    if (!date || !time) return "Give the date and time to post it (or post_now true).";

    await setStep(context, `Scheduling "${title}"`);
    const accountIds: Partial<Record<PostPlatform, string>> = { ...existing?.accountIds };
    for (const choice of input.accounts ?? []) accountIds[choice.platform] = choice.account_id;
    const result = await savePostForScope(
      scope,
      { postId: existing?.id ?? null, draftId: existing ? existing.draftId : (draft?.id ?? null), title, caption, hashtags, platforms, media, date, time, timeZone: input.time_zone, accountIds },
      "schedule"
    );
    if (!result.post) return `Not scheduled: ${result.error}`;
    return `${existing ? "Updated and rescheduled" : "Scheduled"}. ${describePost(result.post)}. It's on the Posts page and in the user's Blotato calendar; Blotato publishes it at that time.`;
  },
});

export const unschedulePostTool = tool({
  name: "unschedule_post",
  description: "Take a scheduled post off the schedule, on the Posts page and in the user's Blotato calendar. It stays on the Posts page as a draft.",
  parameters: z.object({ post_id: z.number().int() }),
  needsApproval: checkpointDue,
  execute: async ({ post_id }, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    await setStep(context, `Unscheduling post #${post_id}`);
    const result = await unschedulePostForScope(context.scope, post_id);
    return result.error ? `Not unscheduled: ${result.error}` : `Post #${post_id} was taken off the schedule and is now a draft.`;
  },
});
