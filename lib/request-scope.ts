import "server-only";
import { getActiveCampaign } from "@/lib/campaigns";
import { getCurrentUser } from "@/lib/insforge/server";
import type { Scope } from "@/lib/orchestration/store";

// The signed-in user's active campaign, for API routes; null when signed out or without a campaign
export async function getRequestScope(): Promise<Scope | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser) return null;
  const campaign = await getActiveCampaign(currentUser.id);
  if (!campaign) return null;
  return { userId: currentUser.id, campaignId: campaign.id };
}
