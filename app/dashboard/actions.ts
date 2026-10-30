"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { campaigns, db } from "@/db";
import { ACTIVE_CAMPAIGN_COOKIE, listUserCampaigns } from "@/lib/campaigns";
import { getCurrentUser } from "@/lib/insforge/server";
import { inngest } from "@/lib/inngest/client";
import { cancelPlan } from "@/lib/orchestration/control";
import { listActivePlans } from "@/lib/orchestration/store";

export async function switchCampaign(campaignId: number) {
  const user = await getCurrentUser();
  if (!user) return;

  // Only allow switching to a campaign the user owns
  const owned = (await listUserCampaigns(user.id)).some((c) => c.id === campaignId);
  if (!owned) return;

  (await cookies()).set(ACTIVE_CAMPAIGN_COOKIE, String(campaignId), { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/dashboard", "layout");
}

// Ends a campaign: its running plans stop, no new work can be planned, and in the background its
// computer's files are uploaded (as campaign artifacts) before the computer is shut down for good
export async function endCampaign(campaignId: number): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };

  const [ended] = await db
    .update(campaigns)
    .set({ endedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id), isNull(campaigns.endedAt)))
    .returning({ id: campaigns.id });
  if (!ended) return { error: "That campaign has already ended." };

  const scope = { userId: user.id, campaignId };
  for (const plan of await listActivePlans(scope)) await cancelPlan(scope, plan.id);
  await inngest.send({ name: "campaign/ended", data: { campaignId, userId: user.id } });
  revalidatePath("/dashboard", "layout");
  return {};
}
