import { formatDistanceToNow } from "date-fns";
import type { PostPlatform } from "@/lib/posts/shared";

// Blotato connections as both the server and the browser see them. Not server-only: nothing here
// touches a key.

// A social account the user connected in Blotato
export type BlotatoAccount = {
  id: string;
  // Blotato's platform name: instagram, tiktok, youtube, twitter, linkedin, facebook, threads…
  platform: string;
  name: string;
  username: string | null;
};

// What Settings and the Accounts page show. Never includes the key itself.
export type IntegrationView = {
  connected: boolean;
  // Last 4 characters of the key
  keyHint: string | null;
  accounts: BlotatoAccount[];
  refreshedAt: string | null;
};

export const NOT_CONNECTED: IntegrationView = { connected: false, keyHint: null, accounts: [], refreshedAt: null };

// Where users connect their social accounts and generate an API key (Settings → API)
export const BLOTATO_SETTINGS_URL = "https://my.blotato.com/settings";

// Connected accounts for each platform posts can go to
export function accountsByPlatform(accounts: BlotatoAccount[]) {
  const grouped: Partial<Record<PostPlatform, BlotatoAccount[]>> = {};
  for (const account of accounts) {
    const platform = account.platform as PostPlatform;
    if (platform !== "instagram" && platform !== "tiktok" && platform !== "youtube") continue;
    (grouped[platform] ??= []).push(account);
  }
  return grouped;
}

export function accountLabel(account: BlotatoAccount) {
  return account.username ? `@${account.username.replace(/^@/, "")}` : account.name;
}

export function refreshedLabel(refreshedAt: string | null) {
  return refreshedAt ? `Checked ${formatDistanceToNow(new Date(refreshedAt), { addSuffix: true })}` : "Not checked yet";
}
