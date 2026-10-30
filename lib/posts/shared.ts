import { z } from "zod";
import { normalizeHashtags, PLATFORM_RULES } from "@/lib/social-platforms";

// Posts as both the server (actions, queries) and the browser (editor, list) see them. Not
// server-only: nothing here touches the database or a key.

// The platforms a post can be scheduled to today
export const POST_PLATFORMS = ["instagram", "tiktok", "youtube"] as const;
export type PostPlatform = (typeof POST_PLATFORMS)[number];

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";

// Posts that haven't gone out yet can still be edited and rescheduled
export const EDITABLE_STATUSES = ["draft", "scheduled", "cancelled"] as const satisfies readonly PostStatus[];
export function isEditable(status: PostStatus) {
  return (EDITABLE_STATUSES as readonly PostStatus[]).includes(status);
}

// Each platform's post in Blotato (lib/posts/publish.ts): scheduled in the user's Blotato calendar
// when the post is scheduled, then what happened once it went out
export type PlatformResult = {
  status: "scheduled" | "submitting" | "in-progress" | "published" | "failed";
  accountId: string | null;
  submissionId?: string | null;
  // The Blotato schedule to cancel when the post is edited or unscheduled
  scheduleId?: string | null;
  url?: string | null;
  error?: string | null;
};
export type PlatformResults = Partial<Record<PostPlatform, PlatformResult>>;

// An image or video on a post. origin: how it got here; for edited images, the image it was made from and
// the ImageKit edits applied; for generated ones, the prompt.
export type PostMedia = {
  url: string;
  fileId: string | null;
  name: string;
  mimeType: string | null;
  origin: "upload" | "generated" | "edited" | "agent";
  sourceUrl?: string | null;
  prompt?: string | null;
  edits?: unknown[] | null;
};

export type PostView = {
  id: number;
  source: "manual" | "ai";
  draftId: number | null;
  title: string;
  caption: string;
  hashtags: string[];
  platforms: PostPlatform[];
  media: PostMedia[];
  status: PostStatus;
  scheduledAt: string | null;
  timeZone: string;
  // The Blotato account each platform goes to (empty: the first connected account for it)
  accountIds: Partial<Record<PostPlatform, string>>;
  results: PlatformResults;
  error: string | null;
  publishedAt: string | null;
  createdAt: string;
};

export const MAX_MEDIA = 10;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const UPLOAD_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES];

export function isVideo(item: { mimeType: string | null; url?: string }) {
  return item.mimeType ? item.mimeType.startsWith("video/") : /\.(mp4|mov|webm)(\?|$)/i.test(item.url ?? "");
}

// Which of a post's media each platform gets: YouTube takes the one video (Shorts and videos only),
// TikTok a video or else the photos, Instagram everything (a reel, a photo or a carousel)
export function mediaForPlatform<T extends { mimeType: string | null; url?: string }>(platform: PostPlatform, media: T[]) {
  const video = media.find((item) => isVideo(item));
  if (platform === "youtube") return video ? [video] : [];
  if (platform === "tiktok") return video ? [video] : media;
  return media;
}

const Media = z.object({
  url: z.url().max(2000),
  fileId: z.string().max(200).nullable(),
  name: z.string().max(200),
  mimeType: z.string().max(100).nullable(),
  origin: z.enum(["upload", "generated", "edited", "agent"]),
  sourceUrl: z.string().max(2000).nullish(),
  prompt: z.string().max(3000).nullish(),
  edits: z.array(z.unknown()).max(20).nullish(),
});

export const PostInput = z.object({
  title: z.string().trim().min(1, "Give the post a title.").max(200),
  caption: z.string().max(5000),
  hashtags: z.array(z.string().max(80)).max(60),
  platforms: z.array(z.enum(POST_PLATFORMS)).min(1, "Pick at least one platform."),
  media: z.array(Media).max(MAX_MEDIA),
  draftId: z.number().int().nullable(),
  // Set when editing an existing post; null creates a new one
  postId: z.number().int().positive().nullable(),
  // Wall-clock date and time in timeZone; required to schedule, optional for a draft
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  timeZone: z.string().max(64),
  // Blotato account id per platform; missing means the first connected account for it
  accountIds: z.partialRecord(z.enum(POST_PLATFORMS), z.string().max(100)).default({}),
});
export type PostInput = z.infer<typeof PostInput>;

// The caption as it would be posted: text, then the hashtags
export function postCaption(post: { caption: string; hashtags: string[] }) {
  return [post.caption.trim(), post.hashtags.join(" ")].filter(Boolean).join("\n\n");
}

// "#Summer, vibes  #sun" → ["#Summer", "#vibes", "#sun"]
export function parseHashtags(text: string) {
  return normalizeHashtags(text.split(/[\s,]+/));
}

// What stops a post from going out on each platform (errors) and what's worth a look (warnings)
export function checkPost(post: { title: string; caption: string; hashtags: string[]; platforms: PostPlatform[]; media: { mimeType: string | null; url: string }[] }) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const length = postCaption(post).length;
  for (const platform of post.platforms) {
    const rules = PLATFORM_RULES[platform];
    if (rules.maxChars && length > rules.maxChars) errors.push(`${rules.name} captions allow ${rules.maxChars.toLocaleString()} characters; this is ${length.toLocaleString()}.`);
    if (rules.maxTitle && post.title.length > rules.maxTitle) errors.push(`${rules.name} titles allow ${rules.maxTitle} characters; this is ${post.title.length}.`);
    if (rules.maxHashtags !== null && post.hashtags.length > rules.maxHashtags) errors.push(`${rules.name} allows ${rules.maxHashtags} hashtags; this has ${post.hashtags.length}.`);
    else if (post.hashtags.length > rules.bestHashtags[1] * 2) warnings.push(`${post.hashtags.length} hashtags is a lot for ${rules.name}; ${rules.bestHashtags[0]}–${rules.bestHashtags[1]} usually works best.`);
  }
  const videos = post.media.filter((item) => isVideo(item)).length;
  const images = post.media.length - videos;
  if (videos > 1) errors.push("Add at most one video to a post.");
  if (post.platforms.includes("instagram") && post.media.length === 0) errors.push("Instagram posts need an image or a video.");
  if (post.platforms.includes("tiktok") && post.media.length === 0) errors.push("TikTok posts need a video or at least one image.");
  if (post.platforms.includes("tiktok") && videos === 1 && images > 0) warnings.push("TikTok gets only the video; the images are left out there.");
  if (post.platforms.includes("youtube") && videos === 0) errors.push("YouTube only takes videos and Shorts: add a video.");
  else if (post.platforms.includes("youtube") && images > 0) warnings.push("YouTube gets only the video; the images are left out there.");
  return { errors, warnings };
}

// Time zones

// The offset (ms) of a time zone from UTC at a moment, e.g. +19800000 for Asia/Kolkata
function zoneOffset(at: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

export function isTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The UTC moment of a wall-clock date and time ("2026-10-20", "09:30") in a time zone. Checked
// twice so a time near a daylight-saving change uses the offset in force at that time.
export function zonedTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let utc = wall - zoneOffset(wall, timeZone);
  utc = wall - zoneOffset(utc, timeZone);
  return new Date(utc);
}

// "2026-10-20" and "09:30" for a moment as seen in a time zone
export function utcToZonedParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(at)
      .map((part) => [part.type, part.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// "Tue, Oct 20 · 9:30 AM GMT+5:30" in the post's own time zone
export function formatInZone(iso: string, timeZone: string, style: "full" | "short" = "full") {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: style === "full" ? "short" : undefined,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: style === "full" ? "short" : undefined,
  }).format(new Date(iso));
}

// Every IANA zone the browser knows, with a short label like "Asia/Kolkata (GMT+5:30)"
export function listTimeZones() {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  const now = new Date();
  return (zones.includes("UTC") ? zones : ["UTC", ...zones]).map((zone) => {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value ?? "";
    return { value: zone, label: `${zone.replace(/_/g, " ")} (${offset})` };
  });
}
