import "server-only";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { agentMessages, db, type AgentMessage, type NewAgentMessage } from "@/db";
import type { AgentRoleId } from "@/lib/agent-roles";

// How many messages the chat loads at a time (first open, then each scroll to the top)
export const CHAT_PAGE_SIZE = 10;

type ChatKey = { userId: string; campaignId: number; agentId: AgentRoleId };

// What the client receives: ids as strings so they sit alongside optimistic (uuid) messages
export type StoredChatMessage = { id: string; from: "user" | "agent"; text: string; createdAt: string; failed?: boolean };

function toStoredMessage(row: AgentMessage): StoredChatMessage {
  return {
    id: String(row.id),
    from: row.sender,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    ...(row.failed && { failed: true }),
  };
}

function chatFilter({ userId, campaignId, agentId }: ChatKey) {
  return and(eq(agentMessages.userId, userId), eq(agentMessages.campaignId, campaignId), eq(agentMessages.agentId, agentId));
}

// A page of the chat, oldest first, ending just before `before` (or at the newest message).
// nextCursor is the id to pass as `before` for the next older page, or null when there are none.
export async function listChatMessages(key: ChatKey, { before, limit = CHAT_PAGE_SIZE }: { before?: number; limit?: number } = {}) {
  const rows = await db
    .select()
    .from(agentMessages)
    .where(before ? and(chatFilter(key), lt(agentMessages.id, before)) : chatFilter(key))
    .orderBy(desc(agentMessages.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit).reverse();
  return {
    messages: page.map(toStoredMessage),
    nextCursor: rows.length > limit ? (page[0]?.id ?? null) : null,
  };
}

// Messages newer than `after`, oldest first: picks up what the Master Agent posts in the background
export async function listChatMessagesAfter(key: ChatKey, after: number, limit = 50) {
  const rows = await db
    .select()
    .from(agentMessages)
    .where(and(chatFilter(key), gt(agentMessages.id, after)))
    .orderBy(asc(agentMessages.id))
    .limit(limit);
  return rows.map(toStoredMessage);
}

export async function getLatestChatMessageId(key: ChatKey) {
  const [row] = await db.select({ id: agentMessages.id }).from(agentMessages).where(chatFilter(key)).orderBy(desc(agentMessages.id)).limit(1);
  return row?.id ?? 0;
}

// The latest messages to give the agent as context, oldest first, skipping cut-off replies
export async function getChatContext(key: ChatKey, limit: number) {
  const rows = await db
    .select({ sender: agentMessages.sender, text: agentMessages.text })
    .from(agentMessages)
    .where(and(chatFilter(key), eq(agentMessages.failed, false)))
    .orderBy(desc(agentMessages.id))
    .limit(limit);
  return rows.reverse();
}

export async function saveChatMessage(key: ChatKey, message: Pick<NewAgentMessage, "sender" | "text" | "failed">) {
  const [row] = await db
    .insert(agentMessages)
    .values({ ...key, ...message })
    .returning({ id: agentMessages.id });
  return row.id;
}
