import "server-only";
import { countPostsByStatus, listUpcomingPosts } from "@/lib/posts/store";

// Data for the dashboard overview. Agent activity isn't stored yet, so it returns an empty result
// and the overview renders its empty state.

export type SocialPlatform = "instagram" | "facebook" | "x" | "linkedin" | "tiktok" | "youtube";

export type UpcomingPost = {
  id: number;
  title: string;
  platform: SocialPlatform;
  scheduledAt: Date;
};

export type ActivityKind = "research" | "content" | "schedule" | "publish" | "analytics";

export type ActivityItem = {
  id: number;
  kind: ActivityKind;
  message: string;
  createdAt: Date;
};

export type CampaignProgress = {
  published: number;
  planned: number;
  percent: number;
};

// One row per scheduled post, under its first platform
export async function getUpcomingPosts(campaignId: number, limit = 4): Promise<UpcomingPost[]> {
  const posts = await listUpcomingPosts(campaignId, limit);
  return posts.map((post) => ({ id: post.id, title: post.title, platform: post.platforms[0] ?? "instagram", scheduledAt: new Date(post.scheduledAt!) }));
}

export async function getRecentActivity(_campaignId: number, _limit = 5): Promise<ActivityItem[]> {
  return [];
}

// Published out of everything planned (scheduled, publishing, published)
export async function getCampaignProgress(campaignId: number): Promise<CampaignProgress> {
  const counts = await countPostsByStatus(campaignId);
  const published = counts.published ?? 0;
  const planned = published + (counts.scheduled ?? 0) + (counts.publishing ?? 0);
  return { published, planned, percent: planned ? Math.round((published / planned) * 100) : 0 };
}
