import "server-only";
import { Agent, run } from "@openai/agents";
import { z } from "zod";
import type { AgentPlan, AgentTask } from "@/db";
import { getAgentRole } from "@/lib/agent-roles";
import { FORMATTING_RULE, teamList } from "@/lib/ai/agents";
import { getOpenAIClient } from "@/lib/ai/openai";

// The Master Agent's background work while a plan runs: answering workers' questions, reviewing
// their output and reporting the result to the user. These runs see the plan, not the user's chat.

const MAX_CONTEXT_OUTPUT = 4000;

export function clip(text: string | null | undefined, max = MAX_CONTEXT_OUTPUT) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}

const BASE = `You are the Master Agent, the coordinator of a team of AI agents working on a social media campaign.
Your team:
${teamList("master")}`;

export function describePlan(plan: Pick<AgentPlan, "id" | "title" | "request">, campaignName: string) {
  return `Campaign: "${campaignName}"\nPlan #${plan.id}: ${plan.title}\nThe user's request:\n"""\n${plan.request}\n"""`;
}

function describeTask(task: AgentTask) {
  return `Task #${task.id} for the ${getAgentRole(task.agentId).name}: ${task.title}\nInstructions:\n${task.instructions}`;
}

const ConsultOutput = z.object({
  needs_user: z.boolean().describe("True only if the question can't reasonably be answered without the user"),
  answer: z.string().describe("The answer for the teammate, or (when needs_user) the question to ask the user"),
});

const consultAgent = new Agent({
  name: "Master Agent (consult)",
  instructions: `${BASE}

A teammate working on one of your tasks has a question. Answer it yourself whenever you can, using the
user's request, the task and sensible defaults for social media work: the team should keep moving.
Set needs_user to true only when the answer depends on facts or preferences only the user can give
(for example their brand name, budget, product details, or a choice with very different outcomes)
and no sensible default would do. Never pass on a question the user's request already answers, or a
detail the teammate can decide (tone, format, length, hashtags, times, style): answer it with a
default and tell the teammate to state it in their result. When the user must be asked, write one
short, friendly question for the user in "answer".`,
  outputType: ConsultOutput,
});

export async function consultMaster(input: { plan: AgentPlan; task: AgentTask; campaignName: string; question: string; context: string }) {
  getOpenAIClient();
  const result = await run(
    consultAgent,
    `${describePlan(input.plan, input.campaignName)}\n\n${describeTask(input.task)}\n\n${input.context ? `What the teammate has so far:\n${input.context}\n\n` : ""}The ${getAgentRole(input.task.agentId).name} asks:\n"""\n${input.question}\n"""`,
    { maxTurns: 5 }
  );
  const output = result.finalOutput;
  if (!output) throw new Error("The Master Agent couldn't answer the question.");
  return output;
}

const ReviewOutput = z.object({
  approved: z.boolean().describe("True if the work does what the task asked, well enough to use"),
  feedback: z.string().describe("If approved: one short sentence on what's good. If not: specific changes needed"),
});

const reviewAgent = new Agent({
  name: "Master Agent (review)",
  instructions: `${BASE}

Review a teammate's work on a task you assigned. Approve it if it follows the instructions, fits the
user's request and is ready to use or hand to the next teammate. Don't ask for perfection or for
things outside the task. If it misses something important, reject it with specific, actionable
feedback the teammate can apply in one revision.
Teammates with a computer work from their own knowledge first and browse only when they need
current information, so not opening any pages is fine. Their work ends with a "Computer activity"
line listing the pages they opened. Reject it only if the work claims something was looked up live
(or presents current figures, posts or trends as checked) but no pages were opened, or if the task
explicitly asked for a live check that wasn't done.`,
  outputType: ReviewOutput,
});

export async function reviewTask(input: { plan: AgentPlan; task: AgentTask; campaignName: string; output: string }) {
  getOpenAIClient();
  const result = await run(
    reviewAgent,
    `${describePlan(input.plan, input.campaignName)}\n\n${describeTask(input.task)}\n\nThe teammate's work:\n"""\n${clip(input.output, 8000)}\n"""`,
    { maxTurns: 5 }
  );
  const output = result.finalOutput;
  if (!output) throw new Error("The Master Agent couldn't review the work.");
  return output;
}

const summaryAgent = new Agent({
  name: "Master Agent (report)",
  instructions: `${BASE}

Every task in a plan is finished. Write the report for the user in the chat: one opening line saying
the plan is done, then the key results from each teammate (keep the most useful details, such as the
actual captions, times or ideas, and drop repetition), then one suggested next step.
Keep it concise. ${FORMATTING_RULE}`,
});

export async function summarizePlan(input: { plan: AgentPlan; tasks: AgentTask[]; campaignName: string }) {
  getOpenAIClient();
  const results = input.tasks
    .map((task) => `${getAgentRole(task.agentId).name} — ${task.title}:\n${clip(task.output)}`)
    .join("\n\n");
  const result = await run(summaryAgent, `${describePlan(input.plan, input.campaignName)}\n\nResults:\n\n${results}`, { maxTurns: 1 });
  return result.finalOutput?.trim() || `"${input.plan.title}" is done. Open the Tasks tab to see each teammate's work.`;
}
