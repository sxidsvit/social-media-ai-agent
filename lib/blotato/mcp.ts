import "server-only";
import { createMCPToolStaticFilter, MCPServerStreamableHttp } from "@openai/agents";
import { BLOTATO_MCP_URL, BlotatoError, type BlotatoPostInput, type BlotatoPostStatus } from "@/lib/blotato/client";
import { getBlotatoApiKey } from "@/lib/blotato/store";
import type { BlotatoMetricsSnapshot } from "@/lib/analytics/shared";

// Blotato's MCP server (https://help.blotato.com/start-with-an-ai-agent/mcp), authenticated with the
// user's own API key. The Master Agent's chat gets its read-only tools (MASTER_BLOTATO_TOOLS: posting
// and scheduling go through the Scheduler Agent and the Posts page, lib/posts/save.ts); the Posts page schedules, cancels and
// tracks posts through the same tools (blotato_create_post, blotato_list_schedules,
// blotato_delete_schedule, blotato_get_post_status), so a scheduled post lives in the user's Blotato
// calendar and Blotato publishes it at its time.

// What the Master Agent may look at in the user's Blotato account. Nothing that posts, schedules or
// changes anything: that's the Scheduler Agent's job, so every post is also on the Posts page.
export const MASTER_BLOTATO_TOOLS = [
  "blotato_list_accounts",
  "blotato_get_post_status",
  "blotato_list_posts",
  "blotato_list_schedules",
  "blotato_get_schedule",
  "blotato_list_top_posts",
  "blotato_get_post_analytics",
];

// allowedTools: only these of Blotato's tools are given to the agent (all of them when unset)
function blotatoServer(apiKey: string, allowedTools?: string[]) {
  return new MCPServerStreamableHttp({
    url: BLOTATO_MCP_URL,
    name: "blotato",
    requestInit: { headers: { "blotato-api-key": apiKey } },
    cacheToolsList: true,
    timeout: 60_000,
    ...(allowedTools ? { toolFilter: createMCPToolStaticFilter({ allowed: allowedTools }) } : {}),
  });
}

// One connection per chat request: connect before the run, close once the reply has finished. Returns
// null when the user hasn't connected Blotato, or the server can't be reached (the chat still works,
// just without Blotato's tools).
export async function connectBlotatoMcp(userId: string, allowedTools?: string[]) {
  const apiKey = await getBlotatoApiKey(userId).catch((error) => {
    console.error("Reading the Blotato key failed", error);
    return null;
  });
  if (!apiKey) return null;

  const server = blotatoServer(apiKey, allowedTools);
  try {
    await server.connect();
    return server;
  } catch (error) {
    console.error("Connecting to Blotato's MCP server failed", error);
    await server.close().catch(() => undefined);
    return null;
  }
}

export type BlotatoMcp = MCPServerStreamableHttp;

// Connects with the key, runs fn, then closes. A connection failure is a BlotatoError with status 0
// (worth retrying).
export async function withBlotatoMcp<T>(apiKey: string, fn: (server: BlotatoMcp) => Promise<T>) {
  const server = blotatoServer(apiKey);
  try {
    await server.connect();
  } catch (error) {
    await server.close().catch(() => undefined);
    throw toBlotatoError(error, 0);
  }
  try {
    return await fn(server);
  } finally {
    await server.close().catch(() => undefined);
  }
}

// Tool errors come back as text; this maps the ones that matter to the REST client's statuses
function errorStatus(message: string, fallback: number) {
  if (/\b(401|403)\b|unauthori[sz]ed|invalid api key|api key (is )?(invalid|revoked)/i.test(message)) return 401;
  if (/\b429\b|rate limit/i.test(message)) return 429;
  if (/\b404\b|not found/i.test(message)) return 404;
  if (/\b5\d\d\b|internal server error|timed? ?out/i.test(message)) return 502;
  return fallback;
}

function toBlotatoError(error: unknown, fallback: number) {
  if (error instanceof BlotatoError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status = errorStatus(message, fallback);
  if (status === 401) return new BlotatoError("Blotato rejected the API key. Generate a new one in Blotato and connect it again.", 401);
  if (status === 429) return new BlotatoError("Blotato's rate limit was hit. Try again in a minute.", 429);
  return new BlotatoError(`Blotato: ${message.slice(0, 300)}`, status);
}

// Calls one tool and returns its result as JSON (structured content, else the text parsed as JSON,
// else { text }). A tool error is thrown as a BlotatoError.
async function callTool<T>(server: BlotatoMcp, name: string, args: Record<string, unknown>): Promise<T> {
  let result: Awaited<ReturnType<BlotatoMcp["callTool"]>>;
  try {
    result = await server.callTool(name, args);
  } catch (error) {
    throw toBlotatoError(error, 0);
  }
  const text = result
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();
  if (result.isError) throw toBlotatoError(new Error(text || `${name} failed`), 400);
  if (result.structuredContent) return result.structuredContent as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { text } as T;
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Creates a post: published now, or scheduled in Blotato when scheduledTime (ISO, UTC) is given.
// Returns the submission id to check with getPostStatus, and the time Blotato scheduled it for.
export async function createPost(server: BlotatoMcp, post: BlotatoPostInput, scheduledTime?: string) {
  const { targetType: _targetType, ...fields } = post.target;
  const body = await callTool<{ postSubmissionId?: string; scheduledTime?: string; text?: string }>(server, "blotato_create_post", {
    accountId: post.accountId,
    platform: post.platform,
    text: post.text,
    mediaUrls: post.mediaUrls,
    ...fields,
    ...(scheduledTime ? { scheduledTime } : {}),
  });
  const submissionId = body.postSubmissionId ?? body.text?.match(UUID)?.[0];
  if (!submissionId) throw new BlotatoError("Blotato didn't return a submission id.", 502);
  return { submissionId, scheduledTime: body.scheduledTime ?? scheduledTime ?? null };
}

export async function getPostStatus(server: BlotatoMcp, submissionId: string) {
  return callTool<BlotatoPostStatus>(server, "blotato_get_post_status", { postSubmissionId: submissionId });
}

export type BlotatoSchedule = { id: string; scheduledAt: string; accountId: string | null; platform: string | null; text: string | null };

type RawSchedule = {
  id?: string | number;
  scheduledAt?: string;
  scheduledTime?: string;
  account?: { id?: string | number } | null;
  draft?: { accountId?: string | number; content?: { text?: string; platform?: string } };
};

// The user's scheduled posts still to go out, soonest first (up to 500)
export async function listSchedules(server: BlotatoMcp) {
  const schedules: BlotatoSchedule[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const body = await callTool<{ items?: RawSchedule[]; schedules?: RawSchedule[]; cursor?: string } | RawSchedule[]>(server, "blotato_list_schedules", {
      limit: 50,
      ...(cursor ? { cursor } : {}),
    });
    const items = Array.isArray(body) ? body : (body.items ?? body.schedules ?? []);
    for (const item of items) {
      const scheduledAt = item.scheduledAt ?? item.scheduledTime;
      if (item.id === undefined || !scheduledAt) continue;
      const accountId = item.draft?.accountId ?? item.account?.id;
      schedules.push({
        id: String(item.id),
        scheduledAt,
        accountId: accountId !== undefined ? String(accountId) : null,
        platform: item.draft?.content?.platform ?? null,
        text: item.draft?.content?.text ?? null,
      });
    }
    cursor = Array.isArray(body) ? undefined : body.cursor;
    if (!cursor || items.length === 0) break;
  }
  return schedules;
}

// Cancels a scheduled post in Blotato. One that's already gone (deleted in Blotato, or published) is fine.
export async function deleteSchedule(server: BlotatoMcp, scheduleId: string) {
  try {
    await callTool(server, "blotato_delete_schedule", { id: scheduleId });
  } catch (error) {
    if (error instanceof BlotatoError && error.status === 404) return;
    throw error;
  }
}

// Analytics (blotato_list_posts, blotato_get_post_analytics). Blotato collects each published post's
// metrics some time after it goes out, so a post's analytics can be null for a while. Metric values
// come back as strings; lib/analytics/shared.ts reads them.

export type BlotatoPublishedPost = {
  id: string;
  platform: string;
  postTime: string;
  text: string | null;
  mediaUrls: string[];
  accountId: string | null;
  state: "published" | "failed";
  postUrl: string | null;
  errorMessage: string | null;
  // Latest metrics and earlier snapshots; null until Blotato has collected them
  metrics: Record<string, unknown> | null;
  metricsAt: string | null;
  history: BlotatoMetricsSnapshot[];
};

type RawAnalytics = {
  latest?: unknown;
  history?: unknown;
  metrics?: unknown;
  lastFetchedAt?: string | null;
  fetchedAt?: string | null;
} | null;

type RawPost = {
  id?: string | number;
  postTime?: string;
  platform?: string;
  text?: string | null;
  mediaUrls?: string[] | null;
  account?: { id?: string | number } | null;
  state?: { type?: string; postUrl?: string | null; errorMessage?: string | null; analytics?: RawAnalytics };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// A snapshot is either the metrics themselves or { fetchedAt, metrics }
function toSnapshot(value: unknown): BlotatoMetricsSnapshot | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.metrics)) return { fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : null, metrics: value.metrics };
  const { fetchedAt, ...metrics } = value;
  return Object.keys(metrics).length ? { fetchedAt: typeof fetchedAt === "string" ? fetchedAt : null, metrics } : null;
}

function readAnalytics(raw: RawAnalytics | undefined) {
  if (!raw) return { metrics: null, metricsAt: null, history: [] };
  const history = (Array.isArray(raw.history) ? raw.history : []).map(toSnapshot).filter((item): item is BlotatoMetricsSnapshot => !!item);
  const latest = toSnapshot(raw.latest ?? raw.metrics) ?? history[history.length - 1] ?? null;
  return { metrics: latest?.metrics ?? null, metricsAt: latest?.fetchedAt ?? raw.lastFetchedAt ?? raw.fetchedAt ?? null, history };
}

// Blotato says "twitter"; the app calls it X
function normalizePlatform(platform: string | undefined) {
  const name = (platform ?? "other").toLowerCase();
  return name === "twitter" ? "x" : name;
}

// The user's published and failed posts between since and until (ISO), most recent first, with their
// metrics. Up to maxPages pages of 250.
export async function listPublishedPosts(server: BlotatoMcp, range: { since: string; until: string }, maxPages = 20) {
  const posts: BlotatoPublishedPost[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const body = await callTool<{ items?: RawPost[]; posts?: RawPost[]; cursor?: string | null } | RawPost[]>(server, "blotato_list_posts", {
      since: range.since,
      until: range.until,
      limit: 250,
      status: ["published", "failed"],
      ...(cursor ? { cursor } : {}),
    });
    const items = Array.isArray(body) ? body : (body.items ?? body.posts ?? []);
    for (const item of items) {
      const type = item.state?.type;
      if (item.id === undefined || !item.postTime || (type !== "published" && type !== "failed")) continue;
      posts.push({
        id: String(item.id),
        platform: normalizePlatform(item.platform),
        postTime: item.postTime,
        text: item.text ?? null,
        mediaUrls: item.mediaUrls ?? [],
        accountId: item.account?.id !== undefined ? String(item.account.id) : null,
        state: type,
        postUrl: item.state?.postUrl ?? null,
        errorMessage: item.state?.errorMessage ?? null,
        ...readAnalytics(item.state?.analytics),
      });
    }
    cursor = Array.isArray(body) ? undefined : (body.cursor ?? undefined);
    if (!cursor || items.length === 0) break;
  }
  return posts;
}

// One published post's latest metrics and their history, straight from Blotato
export async function getPostAnalytics(server: BlotatoMcp, publishedPostId: string) {
  const body = await callTool<{ metrics?: unknown; history?: unknown; lastFetchedAt?: string | null; lastError?: string | null; platform?: string }>(
    server,
    "blotato_get_post_analytics",
    { id: publishedPostId }
  );
  return { ...readAnalytics(body), lastError: body.lastError ?? null };
}
