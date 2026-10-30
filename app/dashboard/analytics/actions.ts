"use server";

import { revalidatePath } from "next/cache";
import { syncAnalytics } from "@/lib/analytics/store";
import { getCurrentUser } from "@/lib/insforge/server";

export type SyncAnalyticsResult = { error?: string; synced?: number };

// Pulls the user's latest published posts and metrics from Blotato (lib/analytics/store.ts)
export async function syncAnalyticsNow(): Promise<SyncAnalyticsResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const result = await syncAnalytics(user.id);
  revalidatePath("/dashboard/analytics");
  return result.error ? { error: result.error } : { synced: result.synced };
}
