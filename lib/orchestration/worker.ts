import "server-only";
import {
  Agent,
  run,
  RunContext,
  RunState,
  tool,
  user,
  type AgentInputItem,
  type CallModelInputFilter,
  type ModelInputData,
  type ModelRetrySettings,
  type Tool,
  type ToolToFinalOutputFunction,
} from "@openai/agents";
import { z } from "zod";
import { AGENT_ROLES, getAgentRole, type WorkerRole, type WorkerRoleId } from "@/lib/agent-roles";
import { saveChatMessage } from "@/lib/agent-chats";
import { getAgentDefinition, SANDBOX_RULES } from "@/lib/ai/agent-definitions";
import { ROLE_INSTRUCTIONS, teamList } from "@/lib/ai/agents";
import { getOpenAIClient } from "@/lib/ai/openai";
import { computerAction } from "@/lib/ai/tools/computer-action";
import type { WorkerContext } from "@/lib/ai/tools/context";
import { fileStorage } from "@/lib/ai/tools/file-storage";
import { REPORT_RESULT, reportResult, REQUEST_USER_ACTION, requestUserAction } from "@/lib/ai/tools/user-and-result";
import { clip, consultMaster, describePlan } from "@/lib/orchestration/coordinator";
import { describeSavedWork } from "@/lib/orchestration/deliverables";
import { addCommunication, getTaskInstructions, listTaskCommunications, updatePlan, updateTask } from "@/lib/orchestration/store";
import type { TaskInterruption, TaskResult } from "@/lib/orchestration/types";

// A worker agent running one task from the Master Agent. It can talk to the Master Agent through
// tools: ask a question (answered by the Master, or passed on to the user) or send a progress update.
// Agents with a sandbox also get the computer and file tools, and can stop to wait for the user.
// Each agent's own instructions and tools come from lib/ai/agent-definitions.ts.

export type { WorkerContext } from "@/lib/ai/tools/context";

const DEFAULT_MAX_TURNS = 8;

const MAX_QUESTIONS = 2;
export const WAITING_REPLY = "WAITING";

const askMaster = tool({
  name: "ask_master",
  description:
    "Ask the Master Agent one question when missing information blocks the task. Prefer reasonable, clearly stated assumptions for small details.",
  parameters: z.object({ question: z.string().describe("One specific question") }),
  execute: async ({ question }, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    const { scope, plan, task } = context;
    if (context.waitingForUser) return `Your question is with the user. Stop now and reply with just: ${WAITING_REPLY}`;
    if (Date.now() >= context.wrapUpAt) return "There's no time left for questions. Make reasonable assumptions, state them briefly, and call report_result now.";
    if (context.questionsAsked >= MAX_QUESTIONS) {
      return "You've asked enough questions. Make reasonable assumptions, state them briefly, and finish the task.";
    }
    context.questionsAsked++;

    await addCommunication(scope, { planId: plan.id, taskId: task.id, from: task.agentId, to: "master", kind: "question", text: question });

    let reply: Awaited<ReturnType<typeof consultMaster>>;
    try {
      reply = await consultMaster({ plan, task, campaignName: context.campaignName, question, context: context.inputs });
    } catch (error) {
      console.error("Master Agent consult failed", error);
      return "The Master Agent couldn't be reached. Make a reasonable assumption, state it, and continue.";
    }

    if (!reply.needs_user) {
      await addCommunication(scope, { planId: plan.id, taskId: task.id, from: "master", to: task.agentId, kind: "answer", text: reply.answer });
      return `The Master Agent says: ${reply.answer}`;
    }

    // Only the user can answer: park the task and ask in the Master Agent's chat
    const parked = await updateTask(task.id, { status: "awaiting_input", question: reply.answer }, ["in_progress"]);
    if (!parked) return "The task was stopped. Reply with just: " + WAITING_REPLY;
    await updatePlan(plan.id, { status: "awaiting_user" }, ["in_progress"]);
    await addCommunication(scope, { planId: plan.id, taskId: task.id, from: "master", to: "user", kind: "clarification", text: reply.answer });
    await saveChatMessage(
      { ...scope, agentId: "master" },
      { sender: "agent", text: `The ${getAgentRole(task.agentId).name} needs your input on "${task.title}" (task #${task.id}):\n\n${reply.answer}` }
    );
    context.waitingForUser = true;
    return `Your question was passed to the user. Stop working now and reply with just: ${WAITING_REPLY}`;
  },
});

const sendUpdate = tool({
  name: "send_update",
  description: "Send the Master Agent a short progress update or a heads-up (for example a risk or an assumption you made).",
  parameters: z.object({ message: z.string() }),
  execute: async ({ message }, runContext?: RunContext<WorkerContext>) => {
    const { scope, plan, task } = runContext!.context;
    await addCommunication(scope, { planId: plan.id, taskId: task.id, from: task.agentId, to: "master", kind: "update", text: message });
    return "The Master Agent has your update.";
  },
});

function taskInstructions(role: WorkerRole, context: WorkerContext) {
  const definition = getAgentDefinition(role.id);
  const extra = [definition.usesSandbox ? SANDBOX_RULES : "", definition.taskInstructions ?? ""].filter(Boolean).join("\n\n");
  return `${ROLE_INSTRUCTIONS[role.id]}
${extra ? `\n${extra}\n` : ""}
You work on the social media campaign "${context.campaignName}" in a team coordinated by the Master Agent:
${teamList(role.id)}

The Master Agent has assigned you a task. How you work on it:
- Do exactly the task you were given, within your role. Use the work your teammates already did.
- Keep the work about social media and make it ready for the platforms the campaign uses. If part
  of the task falls outside social media, do the social media part and say what you left out.
- Finish by calling report_result with a summary, the complete deliverable (ready to use, not a
  description of what you would do) and every file or link you made. Don't greet anyone or ask
  questions in it.
- If something you need is missing, prefer a sensible assumption and state it. Only call ask_master
  when the gap really blocks the work. Use send_update for an important heads-up.
- If the Master Agent left feedback on an earlier version, apply all of it.
- Be honest about your limits; never claim to have posted, scheduled or measured anything a tool
  didn't confirm.
- Write plain text: short paragraphs and "- " lists, no Markdown headings, bold, tables or code blocks.`;
}

function buildTaskAgent(role: WorkerRole) {
  const definition = getAgentDefinition(role.id);
  const tools: Tool<WorkerContext>[] = [askMaster, sendUpdate, reportResult];
  if (definition.usesSandbox) tools.push(computerAction, fileStorage, requestUserAction);
  tools.push(...(definition.tools ?? []));
  return new Agent<WorkerContext>({
    name: role.name,
    instructions: (runContext: RunContext<WorkerContext>) => taskInstructions(role, runContext.context),
    tools,
    // Every turn is a tool call (look, act, ask, or report), so the agent works through the computer
    // step by step and can't end with a made-up answer in plain text. The run ends once it has
    // reported its result (report_result) or its question went to the user (ask_master).
    toolUseBehavior: endWhenReportedOrWaiting,
    resetToolChoice: false,
    // One action at a time: they share a single desktop
    modelSettings: { parallelToolCalls: false, toolChoice: "required", retry: RETRY_MODEL_CALLS },
  });
}

// A model call that fails on the way (a dropped connection, rate limit, server error, or a response
// that came back incomplete) is tried again rather than failing the step. Every call sends the
// whole conversation (nothing is kept on OpenAI's side), so repeating one is safe.
const RETRY_MODEL_CALLS: ModelRetrySettings = {
  maxRetries: 3,
  backoff: { initialDelayMs: 2000, multiplier: 2, maxDelayMs: 15_000, jitter: true },
  policy: ({ normalized }) => {
    const status = normalized.statusCode;
    // A request the API rejects (bad input, auth) fails the same way every time
    if (status && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) return false;
    return { retry: true, approveUnsafeReplay: true };
  },
};

const endWhenReportedOrWaiting: ToolToFinalOutputFunction = (runContext) => {
  const context = runContext.context as WorkerContext;
  if (context.report) return { isFinalOutput: true, isInterrupted: undefined, finalOutput: "Result reported." };
  if (context.waitingForUser) return { isFinalOutput: true, isInterrupted: undefined, finalOutput: WAITING_REPLY };
  return { isFinalOutput: false, isInterrupted: undefined };
};

const TASK_AGENTS = new Map<WorkerRoleId, Agent<WorkerContext>>(AGENT_ROLES.map((role) => [role.id, buildTaskAgent(role)]));

// Everything the worker needs to know for this run: the request, its task, its teammates' results,
// and what's been said about this task so far (answers, review feedback, its last attempt)
async function buildTaskInput(context: WorkerContext) {
  const { plan, task } = context;
  const history = await listTaskCommunications(task.id);
  const notes = history
    .filter((message) => message.kind === "answer" || message.kind === "review" || message.kind === "question")
    .map((message) => `${message.fromAgent === "master" ? "Master Agent" : message.fromAgent === "user" ? "User" : "You"} (${message.kind}): ${message.text}`);

  const parts = [describePlan(plan, context.campaignName), `Your task (#${task.id}): ${task.title}\n${task.instructions}`];
  if (context.inputs) parts.push(`Your teammates' finished work you can build on:\n\n${context.inputs}`);
  if (notes.length) parts.push(`Conversation about this task so far:\n${notes.join("\n")}`);
  const saved = await describeSavedWork(context);
  if (saved) parts.push(`What you already saved in this task (update these with their id instead of saving them again):\n${saved}`);
  if (task.revisions > 0 && task.output) parts.push(`Your previous version (revise it using the feedback above):\n"""\n${clip(task.output)}\n"""`);
  // A finished one-off task running again: the user added information to it or to the work it builds on
  else if (!task.repeat && task.runCount > 0 && task.output) {
    parts.push(`You finished this task before. Redo it with the updated instructions and your teammates' latest work. Your previous version:\n"""\n${clip(task.output)}\n"""`);
  }
  parts.push("Now complete the task.");
  return parts.join("\n\n");
}

// Only the latest screenshots go back to the model; older ones become a short note. Keeps long
// computer sessions affordable. The saved run still has them all.
const KEPT_SCREENSHOTS = 2;

function dropOldScreenshots(modelData: ModelInputData): ModelInputData {
  let kept = 0;
  const input = [...modelData.input];
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i];
    if (item.type !== "function_call_result" || !Array.isArray(item.output)) continue;
    const isImage = (part: { type: string }) => part.type === "image" || part.type === "input_image";
    if (!item.output.some(isImage)) continue;
    if (kept++ < KEPT_SCREENSHOTS) continue;
    input[i] = { ...item, output: item.output.map((part) => (isImage(part) ? { type: "input_text" as const, text: "[older screenshot removed]" } : part)) } as typeof item;
  }
  return { ...modelData, input };
}

// The text of an input message (the run's first input is the task, from buildTaskInput)
function itemText(item: AgentInputItem | undefined) {
  if (!item || !("role" in item) || !("content" in item)) return "";
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return item.content.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join("");
}

// The user can add information to a task while it runs (updateTaskInstructions). The run's first
// input holds the instructions it started with; when the saved ones have grown since, the latest
// version goes after everything else. Filtered input isn't saved, so it's added on every call.
async function addTaskUpdates(modelData: ModelInputData, context: WorkerContext | undefined): Promise<ModelInputData> {
  if (!context) return modelData;
  const latest = await getTaskInstructions(context.task.id).catch((error) => {
    console.warn("Checking for task updates failed", error);
    return null;
  });
  if (!latest || itemText(modelData.input[0]).includes(latest)) return modelData;
  const note = `The Master Agent updated your task while you were working, with information from the user. Your task's instructions are now:\n"""\n${latest}\n"""\nApply the new information from here on; where it conflicts with the earlier instructions, it wins. If it changes work you already did, redo that part.`;
  return { ...modelData, input: [...modelData.input, user(note)] };
}

// Text of a tool call's result (results with a screenshot are a list of parts)
function resultText(item: AgentInputItem) {
  if (item.type !== "function_call_result") return "";
  const output = item.output as unknown;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map((part) => (typeof part?.text === "string" ? part.text : "")).join(" ");
  if (output && typeof output === "object" && "text" in output && typeof output.text === "string") return output.text;
  return "";
}

const TIME_UP =
  "Your time for this task is up. Call report_result now with the most complete deliverable you can make from what you already have (your own knowledge, what you found, your teammates' work). Mark anything you couldn't check or finish. Don't use any other tool.";

const FAILURE = /PROBLEM:|error|failed|couldn.t|took longer|needs (x|text|a full url)|only http/i;
// When to tell the agent to wrap up: this many tool calls before its limit
const WRAP_UP_TURNS = 8;

// Coaching the agent sees before each step, worked out from what it has done so far: it's going in
// circles, its actions keep failing, or it's nearly out of steps. Like the task updates, it isn't
// saved, so it's worked out again on every call.
function coachingNote(input: AgentInputItem[], context: WorkerContext) {
  const calls = input.filter((item): item is Extract<AgentInputItem, { type: "function_call" }> => item.type === "function_call");
  const notes: string[] = [];

  const actions = calls.filter((call) => call.name === "computer_action" || call.name === "web_search").slice(-3);
  const looking = /"action":\s*"(screenshot|wait)"/;
  if (actions.length === 3 && actions.every((call) => call.arguments === actions[0].arguments) && !looking.test(actions[0].arguments)) {
    notes.push("You've done the same action three times in a row and it isn't getting you anywhere. Stop repeating it: look at the latest screenshot, work out why it isn't working, and try a different approach (another address, a search, a keyboard shortcut, a different spot to click).");
  }

  const results = input.filter((item) => item.type === "function_call_result").slice(-3);
  if (results.length === 3 && results.every((item) => FAILURE.test(resultText(item)))) {
    notes.push("Your last three actions ran into problems. Step back: say to yourself what you're trying to do and what went wrong, then fix the cause (for example correct the address, or search for the right page). If you still can't, call ask_master with what you tried and what you see, or finish with what you have and say what you couldn't do.");
  }

  const maxTurns = getAgentDefinition(context.task.agentId).maxTurns ?? DEFAULT_MAX_TURNS;
  const left = maxTurns - calls.length;
  const now = Date.now();
  if (now >= context.deadlineAt) {
    notes.push(TIME_UP);
  } else if (now >= context.wrapUpAt) {
    const minutes = Math.max(1, Math.round((context.deadlineAt - now) / 60_000));
    notes.push(`You have about ${minutes} minute${minutes === 1 ? "" : "s"} left for this task. Don't start anything new: finish the step you're on, then call report_result with what you have, and say what you didn't get to.`);
  } else if (left <= WRAP_UP_TURNS) {
    notes.push(`You have about ${Math.max(left, 1)} steps left for this task. Wrap up now: save anything important, then call report_result with what you've found so far, and say what you didn't get to.`);
  }
  return notes.length ? `Note from your supervisor:\n${notes.map((note) => `- ${note}`).join("\n")}` : "";
}

const filterModelInput: CallModelInputFilter = async ({ modelData, context }) => {
  const worker = context as WorkerContext | undefined;
  const filtered = await addTaskUpdates(dropOldScreenshots(modelData), worker);
  const note = worker ? coachingNote(filtered.input, worker) : "";
  return note ? { ...filtered, input: [...filtered.input, user(note)] } : filtered;
};

// How one go at the task ended:
// - done: it reported (or answered) its result
// - checkpoint: it ran out of time for this step; continue from `state` in the next one
// - waiting: it needs the user in the sandbox; continue from `state` once they're done
// - question: it asked the user a question (ask_master); the task restarts with the answer
export type WorkerOutcome =
  | { kind: "done"; output: string; result: TaskResult | null }
  | { kind: "checkpoint"; state: string }
  | { kind: "waiting"; state: string; interruption: TaskInterruption }
  | { kind: "question" };

// Plain-text version of a report, for the Master Agent's review and the plan summary
export function formatReport(result: TaskResult) {
  const files = result.artifacts.map((artifact) => `- ${artifact.name} (${artifact.type}): ${artifact.url ?? artifact.sandboxPath ?? ""}`);
  return [result.summary, result.details, files.length ? `Files:\n${files.join("\n")}` : ""].filter(Boolean).join("\n\n");
}

// A restored run gets this step's fresh context (contextStrategy "replace"), so what the run learned
// along the way is copied from the saved one: the pages it opened, and whether its report was checked
function carryOverProgress(context: WorkerContext, savedState: string) {
  try {
    const saved = (JSON.parse(savedState) as { context?: { context?: Partial<WorkerContext> } }).context?.context;
    if (Array.isArray(saved?.visitedUrls)) context.visitedUrls = [...new Set([...saved.visitedUrls, ...(context.visitedUrls ?? [])])];
    if (saved?.reportChecked) context.reportChecked = true;
  } catch (error) {
    console.warn("Reading the saved run's progress failed", error);
  }
}

// Restores a saved run and decides each held tool call: a login or other user action is approved
// (the user said they're done); an action held because the user took over is skipped, since the
// screen has changed; a call held at a checkpoint simply runs now.
async function restoreRun(agent: Agent<WorkerContext>, context: WorkerContext, savedState: string) {
  carryOverProgress(context, savedState);
  const state = await RunState.fromStringWithContext(agent, savedState, new RunContext(context), { contextStrategy: "replace" });
  const tookOver = context.task.interruption?.kind === "takeover";
  for (const item of state.getInterruptions()) {
    if (item.name !== REQUEST_USER_ACTION && tookOver) {
      state.reject(item, { message: "The user took over the computer and has handed it back, so this action was skipped. Take a screenshot to see the screen now, then continue." });
    } else {
      state.approve(item);
    }
  }
  return state;
}

// What the agent did on the computer over the whole run (a saved run keeps its earlier items), for
// the Master Agent's review: it shows whether "live research" really opened any pages
function describeComputerActivity(history: AgentInputItem[], context: WorkerContext) {
  const actions: { action?: string; url?: string | null; platform?: string; query?: string }[] = [];
  const searches: string[] = [];
  let reads = 0;
  for (const item of history) {
    if (item.type !== "function_call") continue;
    if (item.name === "read_page") reads++;
    if (item.name !== "computer_action" && item.name !== "web_search") continue;
    let input: (typeof actions)[number] = {};
    try {
      input = JSON.parse(item.arguments);
    } catch {
      // Counted without its details
    }
    if (item.name === "web_search") searches.push(`${input.platform} "${input.query}"`);
    else actions.push(input);
  }
  if (!actions.length && !searches.length && !reads) return "Computer activity: none (worked from its own knowledge; no pages were opened).";
  const pages = [...new Set([...actions.filter((input) => input.action === "open_url" && input.url).map((input) => input.url!), ...(context.visitedUrls ?? [])])];
  return [
    `Computer activity: ${actions.length} actions`,
    searches.length ? `searches: ${searches.join(", ")}` : "",
    reads ? `${reads} pages read` : "",
    `pages opened: ${pages.length ? pages.join(", ") : "none"}.`,
  ]
    .filter(Boolean)
    .join("; ");
}

// The task's time is up: one last pass where the only tool is report_result, so the agent hands back
// what it has. The tool calls it was about to make never ran, so each gets a result saying so.
async function finishWithWhatItHas(agent: Agent<WorkerContext>, context: WorkerContext, history: AgentInputItem[], signal?: AbortSignal) {
  const answered = new Set(history.filter((item) => item.type === "function_call_result").map((item) => item.callId));
  const input: AgentInputItem[] = [];
  for (const item of history) {
    input.push(item);
    if (item.type === "function_call" && !answered.has(item.callId)) {
      input.push({ type: "function_call_result", name: item.name, callId: item.callId, status: "completed", output: "Not run: the time for this task is up." });
    }
  }
  const finisher = agent.clone({
    tools: [reportResult],
    modelSettings: { ...agent.modelSettings, toolChoice: REPORT_RESULT },
  });
  await run(finisher, [...input, user(TIME_UP)], { context, maxTurns: 3, signal, callModelInputFilter: filterModelInput });
}

// savedState: the run to continue (RunState.toString), or null to start the task
export async function runWorker(context: WorkerContext, savedState: string | null, signal?: AbortSignal): Promise<WorkerOutcome> {
  getOpenAIClient();
  const agent = TASK_AGENTS.get(context.task.agentId);
  if (!agent) throw new Error(`Unknown agent: ${context.task.agentId}`);
  const maxTurns = getAgentDefinition(context.task.agentId).maxTurns ?? DEFAULT_MAX_TURNS;
  const options = { maxTurns, signal, callModelInputFilter: filterModelInput };

  const result = savedState
    ? await run(agent, await restoreRun(agent, context, savedState), options)
    : await run(agent, await buildTaskInput(context), { ...options, context });

  const interruptions = result.interruptions ?? [];
  if (interruptions.length) {
    const state = result.state.toString();
    const ask = interruptions.find((item) => item.name === REQUEST_USER_ACTION);
    if (ask) {
      let args: Partial<TaskInterruption> = {};
      try {
        args = JSON.parse(ask.arguments ?? "{}");
      } catch {
        // Fall back to a generic request
      }
      return {
        kind: "waiting",
        state,
        interruption: {
          kind: args.kind === "login" ? "login" : "action",
          reason: args.reason?.trim() || "The agent needs you to do something on the computer.",
          url: args.url ?? null,
          platform: args.platform ?? null,
        },
      };
    }
    if (context.takeover) {
      return { kind: "waiting", state, interruption: { kind: "takeover", reason: "You took control of the computer. Hand it back when you're done." } };
    }
    if (Date.now() < context.deadlineAt) return { kind: "checkpoint", state };
    await finishWithWhatItHas(agent, context, result.history, signal);
  }

  if (context.waitingForUser) return { kind: "question" };
  const activity = context.sandbox ? describeComputerActivity(result.history, context) : "";
  if (context.report) return { kind: "done", output: [formatReport(context.report), activity].filter(Boolean).join("\n\n"), result: context.report };
  // "WAITING" without a question to the user isn't any work
  const output = String(result.finalOutput ?? "").trim();
  return { kind: "done", output: output === WAITING_REPLY ? "" : output, result: null };
}
