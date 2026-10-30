import { redirect } from "next/navigation";
import { getActiveCampaign } from "@/lib/campaigns";
import { getCurrentUser } from "@/lib/insforge/server";
import { listCalendarPosts } from "@/lib/posts/store";
import { CalendarBoard } from "@/components/calendar/calendar-board";

export const metadata = { title: "Calendar" };

// The active campaign's posts on a month or week calendar. Shell (sidebar, header, auth + campaign
// guards) lives in ../layout.tsx
export default async function CalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const campaign = await getActiveCampaign(user.id);
  if (!campaign) redirect("/create-campaign");

  const posts = await listCalendarPosts({ userId: user.id, campaignId: campaign.id });
  const initials = campaign.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  // Keyed by campaign so switching campaigns starts fresh
  return <CalendarBoard key={campaign.id} posts={posts} account={campaign.name || (user.profile?.name ?? user.email)} initials={initials || "AI"} />;
}
