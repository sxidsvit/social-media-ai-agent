import "server-only";
import OpenAI from "openai";
import { setDefaultOpenAIClient } from "@openai/agents";

// One OpenAI client for the whole server, shared by every agent run. Kept on globalThis so dev hot
// reloads don't open a new client each time. The key never leaves the server.
const globalForOpenAI = globalThis as unknown as { openai?: OpenAI };

export function getOpenAIClient() {
  if (!globalForOpenAI.openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    // A stuck request fails (and is retried) instead of holding a task until its step times out
    globalForOpenAI.openai = new OpenAI({ apiKey, timeout: 120_000, maxRetries: 2 });
  }
  // Agents SDK runs use this client instead of building their own
  setDefaultOpenAIClient(globalForOpenAI.openai);
  return globalForOpenAI.openai;
}
