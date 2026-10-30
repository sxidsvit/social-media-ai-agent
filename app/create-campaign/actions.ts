"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { campaigns, db } from "@/db";
import { getCampaignIcon } from "@/lib/campaign-icons";
import { ACTIVE_CAMPAIGN_COOKIE, listOffices } from "@/lib/campaigns";
import { createInsForgeServerClient } from "@/lib/insforge/server";

export type CreateCampaignState = { error?: string };

const ICON_BUCKET = "campaign-icons";
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const ICON_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"];

export async function createCampaign(
  _prev: CreateCampaignState,
  formData: FormData
): Promise<CreateCampaignState> {
  const insforge = await createInsForgeServerClient();
  const { data: auth } = await insforge.auth.getCurrentUser();
  const user = auth?.user;
  if (!user) redirect("/sign-in");

  const name = String(formData.get("name") ?? "").trim();
  const iconId = String(formData.get("icon") ?? "");
  const iconFile = formData.get("iconFile");
  const officeId = String(formData.get("office") ?? "");

  if (!name) return { error: "Give your campaign a name." };
  if (name.length > 60) return { error: "Campaign name must be 60 characters or fewer." };

  const office = (await listOffices()).find((o) => o.id === officeId);
  if (!office) return { error: "Choose an office for your AI agents." };

  let icon: string | null = null;
  let iconUrl: string | null = null;
  let iconKey: string | null = null;

  if (iconFile instanceof File && iconFile.size > 0) {
    if (!ICON_TYPES.includes(iconFile.type)) return { error: "Icon must be a PNG, JPG, WEBP, GIF or SVG image." };
    if (iconFile.size > MAX_ICON_BYTES) return { error: "Icon must be 2MB or smaller." };

    const ext = iconFile.name.split(".").pop()?.toLowerCase() || "png";
    const { data, error } = await insforge.storage
      .from(ICON_BUCKET)
      .upload(`${user.id}/${Date.now()}.${ext}`, iconFile);
    if (error || !data) return { error: "Couldn't upload your icon. Please try again." };

    iconUrl = data.url;
    iconKey = data.key;
  } else if (getCampaignIcon(iconId)) {
    icon = iconId;
  } else {
    return { error: "Pick an icon or upload your own." };
  }

  const [created] = await db
    .insert(campaigns)
    .values({
      userId: user.id,
      name,
      icon,
      iconUrl,
      iconKey,
      officeImage: office.src,
    })
    .returning({ id: campaigns.id });

  // Jump straight into the new campaign
  (await cookies()).set(ACTIVE_CAMPAIGN_COOKIE, String(created.id), { path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}
