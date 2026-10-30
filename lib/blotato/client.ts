import "server-only";
import type { BlotatoAccount } from "@/lib/blotato/shared";

// Blotato's REST API (https://help.blotato.com/api/start), called with the user's own API key, for
// checking a key and listing its accounts. Posts are created, scheduled and tracked through Blotato's
// MCP server (lib/blotato/mcp.ts). The key only ever lives in server memory for the length of a
// request or job step.

const BASE_URL = "https://backend.blotato.com/v2";
export const BLOTATO_MCP_URL = "https://mcp.blotato.com/mcp";
const TIMEOUT_MS = 30_000;

export class BlotatoError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "BlotatoError";
  }

  // The key is wrong or was revoked: retrying won't help
  get unauthorized() {
    return this.status === 401 || this.status === 403;
  }
}

async function blotato<T>(apiKey: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: { "blotato-api-key": apiKey, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new BlotatoError(`Couldn't reach Blotato: ${(error as Error).message}`, 0);
  }
  const body = (await response.json().catch(() => null)) as (T & { message?: string; error?: string }) | null;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new BlotatoError("Blotato rejected the API key. Generate a new one in Blotato and connect it again.", response.status);
    if (response.status === 429) throw new BlotatoError("Blotato's rate limit was hit. Try again in a minute.", 429);
    const detail = body?.message ?? body?.error;
    throw new BlotatoError(`Blotato returned ${response.status}${detail ? `: ${String(detail).slice(0, 300)}` : ""}`, response.status);
  }
  return body as T;
}

type RawAccount = { id: string | number; platform?: string; fullname?: string; username?: string };

// The social accounts connected in the user's Blotato workspace. Also how a key is checked.
export async function listBlotatoAccounts(apiKey: string): Promise<BlotatoAccount[]> {
  const body = await blotato<{ items?: RawAccount[] }>(apiKey, "/users/me/accounts");
  return (body.items ?? []).map((item) => ({
    id: String(item.id),
    platform: (item.platform ?? "other").toLowerCase(),
    name: item.fullname || item.username || `Account ${item.id}`,
    username: item.username || null,
  }));
}

export type BlotatoTarget =
  | { targetType: "instagram"; mediaType?: "reel" | "story" }
  | {
      targetType: "tiktok";
      privacyLevel: "SELF_ONLY" | "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR";
      disabledComments: boolean;
      disabledDuet: boolean;
      disabledStitch: boolean;
      isBrandedContent: boolean;
      isYourBrand: boolean;
      isAiGenerated: boolean;
      title?: string;
    }
  | {
      targetType: "youtube";
      title: string;
      privacyStatus: "public" | "private" | "unlisted";
      shouldNotifySubscribers: boolean;
      isMadeForKids?: boolean;
      containsSyntheticMedia?: boolean;
    };

export type BlotatoPostInput = {
  accountId: string;
  platform: BlotatoTarget["targetType"];
  text: string;
  mediaUrls: string[];
  target: BlotatoTarget;
};

export type BlotatoPostStatus = {
  status: "in-progress" | "scheduled" | "published" | "failed";
  publicUrl?: string;
  errorMessage?: string;
};
