import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/insforge/server";
import { listOffices, listUserCampaigns } from "@/lib/campaigns";
import { CreateCampaignWizard } from "@/components/campaign/create-campaign-wizard";

export const metadata: Metadata = { title: "Create your campaign" };

export default async function CreateCampaignPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const [offices, existing] = await Promise.all([listOffices(), listUserCampaigns(user.id)]);
  return <CreateCampaignWizard offices={offices} isFirst={existing.length === 0} />;
}
