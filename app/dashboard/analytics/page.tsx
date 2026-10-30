import { redirect } from "next/navigation";
import { getSyncState, listAnalyticsPosts } from "@/lib/analytics/store";
import { getActiveCampaign, listUserCampaigns } from "@/lib/campaigns";
import { getCurrentUser } from "@/lib/insforge/server";
import { AnalyticsBoard } from "@/components/analytics/analytics-board";

export const metadata = { title: "Analytics" };

// How the user's posts perform, from the metrics their platforms reported through Blotato (synced into
// post_analytics; the board syncs again on load when they're stale). Shell (sidebar, header, auth +
// campaign guards) lives in ../layout.tsx
export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const campaign = await getActiveCampaign(user.id);
  if (!campaign) redirect("/create-campaign");

  const [posts, sync, campaigns] = await Promise.all([listAnalyticsPosts(user.id), getSyncState(user.id), listUserCampaigns(user.id)]);

  return (
    <AnalyticsBoard
      posts={posts}
      sync={sync}
      campaigns={campaigns.map((item) => ({ id: item.id, name: item.name }))}
      activeCampaignId={campaign.id}
    />
  );
}
