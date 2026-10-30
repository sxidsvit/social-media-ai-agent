import { readdir } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { cookies } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { campaigns, db } from "@/db";

// Cookie holding the id of the campaign the user is currently working in.
export const ACTIVE_CAMPAIGN_COOKIE = "active_campaign";

export type Office = { id: string; name: string; src: string };

const OFFICES_DIR = path.join(process.cwd(), "public", "offices");
const IMAGE_EXT = /\.(png|jpe?g|webp|avif)$/i;

export async function getUserCampaign(userId: string) {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt))
    .limit(1);
  return campaign ?? null;
}

// All of a user's campaigns, newest first. Cached per request so layout + page share one query.
export const listUserCampaigns = cache(async (userId: string) => {
  return db.select().from(campaigns).where(eq(campaigns.userId, userId)).orderBy(desc(campaigns.createdAt));
});

// The campaign selected in the switcher, falling back to the newest one.
export async function getActiveCampaign(userId: string) {
  const all = await listUserCampaigns(userId);
  const activeId = Number((await cookies()).get(ACTIVE_CAMPAIGN_COOKIE)?.value);
  return all.find((c) => c.id === activeId) ?? all[0] ?? null;
}

// Where a freshly authenticated user should land.
export async function getHomePath(userId: string) {
  return (await getUserCampaign(userId)) ? "/dashboard" : "/create-campaign";
}

// AI agent office options, read from /public/offices so new images show up automatically.
export async function listOffices(): Promise<Office[]> {
  const files = await readdir(OFFICES_DIR).catch(() => [] as string[]);
  return files
    .filter((file) => IMAGE_EXT.test(file))
    .sort()
    .map((file) => {
      const id = file.replace(IMAGE_EXT, "");
      const name = id
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      return { id, name, src: `/offices/${file}` };
    });
}
