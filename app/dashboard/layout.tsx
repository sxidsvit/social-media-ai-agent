import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/insforge/server";
import { getActiveCampaign, listUserCampaigns } from "@/lib/campaigns";
import { SIDEBAR_COOKIE } from "@/lib/dashboard-nav";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const [campaigns, active] = await Promise.all([listUserCampaigns(user.id), getActiveCampaign(user.id)]);
  if (!active) redirect("/create-campaign");

  // Sidebar starts as an icon rail unless the user expanded it before
  const defaultExpanded = (await cookies()).get(SIDEBAR_COOKIE)?.value === "true";

  const name = user.profile?.name ?? user.email;
  const initials = name
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <DashboardShell
      campaigns={campaigns.map(({ id, name, icon, iconUrl, endedAt }) => ({ id, name, icon, iconUrl, ended: !!endedAt }))}
      activeCampaignId={active.id}
      user={{ name, email: user.email, initials, avatarUrl: user.profile?.avatar_url }}
      defaultExpanded={defaultExpanded}
    >
      {children}
    </DashboardShell>
  );
}
