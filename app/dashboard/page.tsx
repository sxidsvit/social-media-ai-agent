import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/insforge/server";
import { getActiveCampaign } from "@/lib/campaigns";
import { getCampaignProgress, getRecentActivity, getUpcomingPosts } from "@/lib/overview";
import { getOfficeScene, officeIdFromImage } from "@/lib/office-studio";
import { AgentWorkspace } from "@/components/agents/agent-workspace";
import { CampaignStatusCard } from "@/components/dashboard/overview/campaign-status-card";
import { Greeting } from "@/components/dashboard/overview/greeting";
import { MasterAgentCard } from "@/components/dashboard/overview/master-agent-card";
import { RecentActivityCard } from "@/components/dashboard/overview/recent-activity-card";
import { UpcomingPostsCard } from "@/components/dashboard/overview/upcoming-posts-card";

export const metadata = { title: "Overview" };

// Shell (sidebar, header, auth + campaign guards) lives in ./layout.tsx
export default async function OverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const campaign = await getActiveCampaign(user.id);
  if (!campaign) redirect("/create-campaign");

  const [progress, posts, activity, office] = await Promise.all([
    getCampaignProgress(campaign.id),
    getUpcomingPosts(campaign.id),
    getRecentActivity(campaign.id),
    getOfficeScene(officeIdFromImage(campaign.officeImage)),
  ]);

  const firstName = user.profile?.name?.split(" ")[0];
  const name = user.profile?.name ?? user.email;
  const initials = name
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  // Clicking an agent in the office opens its chat in place of these cards, without leaving the page
  return (
    <AgentWorkspace office={office} officeImage={campaign.officeImage} activity={activity} userInitials={initials}>
      <div className="space-y-3 px-1 pt-1">
        <Greeting name={firstName} />
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Your AI Creative Team is on it.
        </h2>
        <p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground">
          From trends to content to posting, your agents work together to turn ideas into real growth.
        </p>
      </div>

      <MasterAgentCard />
      <CampaignStatusCard campaign={campaign} progress={progress} />
      <UpcomingPostsCard posts={posts} />
      <RecentActivityCard items={activity} />
    </AgentWorkspace>
  );
}
