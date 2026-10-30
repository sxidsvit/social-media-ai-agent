import "server-only";
import { and, eq } from "drizzle-orm";
import { db, userIntegrations, type UserIntegration } from "@/db";
import { listBlotatoAccounts } from "@/lib/blotato/client";
import { accountsByPlatform, NOT_CONNECTED, type IntegrationView } from "@/lib/blotato/shared";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { POST_PLATFORMS, type PostPlatform } from "@/lib/posts/shared";

// Each user's Blotato connection. The key is encrypted at rest and only decrypted on the server, just
// before a call to Blotato; it is never returned to the browser or from an Inngest step.

function toView(row: UserIntegration | undefined): IntegrationView {
  if (!row) return NOT_CONNECTED;
  return { connected: true, keyHint: row.keyHint, accounts: row.accounts, refreshedAt: row.accountsRefreshedAt?.toISOString() ?? null };
}

async function getRow(userId: string) {
  const [row] = await db
    .select()
    .from(userIntegrations)
    .where(and(eq(userIntegrations.userId, userId), eq(userIntegrations.provider, "blotato")));
  return row;
}

export async function getBlotatoIntegration(userId: string) {
  return toView(await getRow(userId));
}

// The user's decrypted key, or null when they haven't connected Blotato
export async function getBlotatoApiKey(userId: string) {
  const row = await getRow(userId);
  return row ? decryptSecret(row.apiKeyEncrypted) : null;
}

// Checks the key against Blotato (listing the accounts), then stores it encrypted with those accounts
export async function connectBlotato(userId: string, apiKey: string) {
  const accounts = await listBlotatoAccounts(apiKey);
  const now = new Date();
  const values = { apiKeyEncrypted: encryptSecret(apiKey), keyHint: apiKey.slice(-4), accounts, accountsRefreshedAt: now, updatedAt: now };
  const [row] = await db
    .insert(userIntegrations)
    .values({ userId, provider: "blotato", ...values })
    .onConflictDoUpdate({ target: [userIntegrations.userId, userIntegrations.provider], set: values })
    .returning();
  return toView(row);
}

// Fetches the connected accounts again (after the user connects or removes one in Blotato)
export async function refreshBlotatoAccounts(userId: string) {
  const row = await getRow(userId);
  if (!row) return NOT_CONNECTED;
  const accounts = await listBlotatoAccounts(decryptSecret(row.apiKeyEncrypted));
  const now = new Date();
  const [updated] = await db
    .update(userIntegrations)
    .set({ accounts, accountsRefreshedAt: now, updatedAt: now })
    .where(eq(userIntegrations.id, row.id))
    .returning();
  return toView(updated);
}

export async function disconnectBlotato(userId: string) {
  await db.delete(userIntegrations).where(and(eq(userIntegrations.userId, userId), eq(userIntegrations.provider, "blotato")));
}

// The platforms posts can go to right now, with their accounts
export async function getPublishingAccounts(userId: string) {
  const integration = await getBlotatoIntegration(userId);
  const byPlatform = accountsByPlatform(integration.accounts);
  const platforms = POST_PLATFORMS.filter((platform) => byPlatform[platform]?.length);
  return { platforms: platforms as PostPlatform[], byPlatform };
}
