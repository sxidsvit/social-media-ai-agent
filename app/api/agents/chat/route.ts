import { after } from "next/server";
import { run, user, assistant, type AgentInputItem } from "@openai/agents";
import { z } from "zod";
import { getCurrentUser } from "@/lib/insforge/server";
import { getActiveCampaign } from "@/lib/campaigns";
import { getOpenAIClient } from "@/lib/ai/openai";
import { AGENT_IDS, chatMaxTurns, getAgent, type AgentRunContext } from "@/lib/ai/agents";
import { buildMasterState, masterAgent, type MasterRunContext } from "@/lib/ai/master";
import { connectBlotatoMcp, MASTER_BLOTATO_TOOLS } from "@/lib/blotato/mcp";
import { CHAT_PAGE_SIZE, getChatContext, listChatMessages, listChatMessagesAfter, saveChatMessage } from "@/lib/agent-chats";
import { dispatchDueTasks } from "@/lib/orchestration/engine";
import { isValidTimeZone } from "@/lib/orchestration/repeat";
import { listAgentTasks, type Scope } from "@/lib/orchestration/store";
import { TASK_STATUS_LABELS } from "@/lib/orchestration/types";
import type { WorkerRoleId } from "@/lib/agent-roles";

export const runtime = "nodejs";
export const maxDuration = 300;

// The Master Agent plus every worker agent
const CHAT_AGENT_IDS = ["master", ...AGENT_IDS] as const;

// The saved conversation is sent as context; caps keep requests (and token spend) bounded
const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 4000;
const CUT_OFF_NOTE = "\n\n(The reply was cut off. Please try again.)";

const ChatRequest = z.object({
  agentId: z.enum(CHAT_AGENT_IDS),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  instructions: z.string().max(2000).optional(),
  // The browser's IANA time zone, so the Master Agent schedules in the user's local time
  timeZone: z.string().max(64).refine(isValidTimeZone).optional(),
});

const HistoryQuery = z.object({
  agentId: z.enum(CHAT_AGENT_IDS),
  before: z.coerce.number().int().positive().optional(),
  // Newer messages only (ids above this), for picking up what the Master Agent posted in the background
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(CHAT_PAGE_SIZE),
});

// A page of the saved chat with an agent: ?agentId=research[&before=<message id>][&limit=10],
// or everything newer than a message: ?agentId=master&after=<message id>
export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return Response.json({ error: "Not signed in" }, { status: 401 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = HistoryQuery.safeParse(params);
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { agentId, before, after: afterId, limit } = parsed.data;

  const campaign = await getActiveCampaign(currentUser.id);
  if (!campaign) return Response.json({ error: "No active campaign" }, { status: 400 });

  const key = { userId: currentUser.id, campaignId: campaign.id, agentId };
  if (afterId !== undefined) {
    return Response.json({ messages: await listChatMessagesAfter(key, afterId) }, { headers: { "Cache-Control": "no-store" } });
  }
  const page = await listChatMessages(key, { before, limit });
  return Response.json(page, { headers: { "Cache-Control": "no-store" } });
}

// Starts the agent's reply. The Master Agent gets the team's current state and its planning tools,
// plus Blotato's read-only tools (with the user's own key) when they've connected Blotato; a worker
// gets its latest assignments so it can answer questions about them.
async function startRun(
  agentId: (typeof CHAT_AGENT_IDS)[number],
  scope: Scope,
  campaignName: string,
  instructions: string | undefined,
  timeZone: string,
  input: AgentInputItem[],
  signal: AbortSignal
) {
  if (agentId === "master") {
    const [state, blotato] = await Promise.all([buildMasterState(scope), connectBlotatoMcp(scope.userId, MASTER_BLOTATO_TOOLS)]);
    const context: MasterRunContext = {
      scope,
      campaignName,
      userInstructions: instructions,
      timeZone,
      state,
      plansToAdvance: new Set(),
      blotato: !!blotato,
    };
    const agent = blotato ? masterAgent.clone({ mcpServers: [blotato] }) : masterAgent;
    let result;
    try {
      result = await run(agent, input, { stream: true, context, signal, maxTurns: 10 });
    } catch (error) {
      await blotato?.close().catch(() => undefined);
      throw error;
    }
    const started = result;
    // Once the reply has been sent, close the Blotato connection and hand tasks due in the next 15
    // minutes to Inngest right away; later ones are queued by the cron
    after(async () => {
      await started.completed.catch(() => undefined);
      await blotato?.close().catch(() => undefined);
      await dispatchDueTasks({ planIds: [...context.plansToAdvance] });
    });
    return result;
  }

  const context: AgentRunContext = { campaignName, userInstructions: instructions, assignments: await describeAssignments(scope, agentId), scope };
  return run(getAgent(agentId), input, { stream: true, context, signal, maxTurns: chatMaxTurns(agentId) });
}

async function describeAssignments(scope: Scope, agentId: WorkerRoleId) {
  const tasks = await listAgentTasks(scope, agentId, 6);
  if (tasks.length === 0) return undefined;
  return tasks
    .map((task) => {
      const result = task.output ? `\n  Result: ${task.output.slice(0, 600)}${task.output.length > 600 ? "…" : ""}` : "";
      return `- #${task.id} ${task.title} [${TASK_STATUS_LABELS[task.status]}]${result}`;
    })
    .join("\n");
}

// Saves the task, then streams the agent's reply as plain text and saves it once it ends
export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = ChatRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { agentId, text, instructions, timeZone = "UTC" } = parsed.data;

  const campaign = await getActiveCampaign(currentUser.id);
  if (!campaign) return Response.json({ error: "No active campaign" }, { status: 400 });

  const chat = { userId: currentUser.id, campaignId: campaign.id, agentId };

  try {
    getOpenAIClient();
    await saveChatMessage(chat, { sender: "user", text });
    const history = await getChatContext(chat, MAX_MESSAGES);
    const input: AgentInputItem[] = history.map((m) => (m.sender === "user" ? user(m.text) : assistant(m.text)));
    const scope = { userId: currentUser.id, campaignId: campaign.id };

    const result = await startRun(agentId, scope, campaign.name, instructions, timeZone, input, request.signal);

    // The SDK types its stream with its own shim; at runtime it's the platform ReadableStream
    const source = (result.toTextStream() as unknown as ReadableStream<string>).getReader();
    let reply = "";
    let saved = false;
    // Saves the reply exactly once; a reply that didn't finish is kept but marked as cut off
    const saveReply = (complete: boolean) => {
      if (saved || !reply) return;
      saved = true;
      saveChatMessage(chat, complete ? { sender: "agent", text: reply } : { sender: "agent", text: reply + CUT_OFF_NOTE, failed: true }).catch(
        (error) => console.error("Saving agent reply failed", error)
      );
    };

    const stream = new ReadableStream<string>({
      async pull(controller) {
        try {
          const { done, value } = await source.read();
          if (done) {
            saveReply(true);
            controller.close();
            return;
          }
          reply += value;
          controller.enqueue(value);
        } catch (error) {
          console.error("Agent reply stream failed", error);
          saveReply(false);
          controller.error(error);
        }
      },
      // The client went away (closed the page or sent another task) mid-reply
      async cancel(reason) {
        saveReply(false);
        await source.cancel(reason);
      },
    });

    return new Response(stream.pipeThrough(new TextEncoderStream()), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Agent chat failed", error);
    return Response.json({ error: "The agent couldn't reply right now. Please try again." }, { status: 502 });
  }
}
