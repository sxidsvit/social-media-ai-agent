"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BlotatoError } from "@/lib/blotato/client";
import type { IntegrationView } from "@/lib/blotato/shared";
import { connectBlotato, disconnectBlotato, refreshBlotatoAccounts } from "@/lib/blotato/store";
import { isEncryptionConfigured } from "@/lib/crypto/secrets";
import { getCurrentUser } from "@/lib/insforge/server";

export type IntegrationResult = { error?: string; integration?: IntegrationView };

const ApiKey = z.string().trim().min(10, "That doesn't look like a Blotato API key.").max(500, "That doesn't look like a Blotato API key.");

function describe(error: unknown, fallback: string) {
  if (error instanceof BlotatoError) return error.message;
  console.error(fallback, error);
  return fallback;
}

function revalidate() {
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/accounts");
  revalidatePath("/dashboard/posts", "layout");
}

// Checks the key with Blotato, then stores it encrypted along with the user's connected accounts
export async function saveBlotatoKey(apiKey: string): Promise<IntegrationResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  if (!isEncryptionConfigured()) return { error: "The server can't store keys yet: add INTEGRATIONS_ENCRYPTION_KEY to .env.local." };
  const parsed = ApiKey.safeParse(apiKey);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    const integration = await connectBlotato(user.id, parsed.data);
    revalidate();
    return { integration };
  } catch (error) {
    return { error: describe(error, "The key couldn't be checked. Please try again.") };
  }
}

export async function refreshBlotato(): Promise<IntegrationResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  try {
    const integration = await refreshBlotatoAccounts(user.id);
    if (!integration.connected) return { error: "Connect Blotato first." };
    revalidate();
    return { integration };
  } catch (error) {
    return { error: describe(error, "Your accounts couldn't be refreshed. Please try again.") };
  }
}

export async function removeBlotato(): Promise<IntegrationResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  await disconnectBlotato(user.id);
  revalidate();
  return {};
}
