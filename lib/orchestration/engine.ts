import "server-only";
import { eq } from "drizzle-orm";
import { campaigns, db, type AgentPlan, type AgentTask } from "@/db";
import { getAgentRole } from "@/lib/agent-roles";
import { saveChatMessage } from "@/lib/agent-chats";
import { getAgentDefinition, REVISION_TIME_LIMIT } from "@/lib/ai/agent-definitions";
import { SandboxHandle } from "@/lib/ai/tools/context";
import { inngest } from "@/lib/inngest/client";
import { describeDependencyArtifacts, saveReportedArtifacts } from "@/lib/orchestration/artifacts";
import { clip, reviewTask, summarizePlan } from "@/lib/orchestration/coordinator";
import { describeDependencyWork, saveAgentOutput } from "@/lib/orchestration/deliverables";
import { describeRepeat, nextOccurrence } from "@/lib/orchestration/repeat";
import {
  addCommunication,
  claimTask,
  expireWaitingTasks,
  finishTaskRun,
  getPlan,
  getTask,
  getTaskRunId,
  listPlanTasks,
  queueDueTasks,
  releaseQueuedTask,
  saveRunResult,
  updateOwnedTask,
  updatePlan,
  updateTask,
  type DispatchedTask,
  type Scope,
} from "@/lib/orchestration/store";
import { ACTIVE_PLAN_STATUSES } from "@/lib/orchestration/types";
import { runWorker, type WorkerContext, type WorkerOutcome } from "@/lib/orchestration/worker";
import { acquireSandboxLease, getCampaignEndedAt, pauseAgentSandbox, releaseSandboxLease, renewSandboxLease } from "@/lib/sandbox/agent-sandbox";

// Runs scheduled tasks. Nothing executes inside a web request: due tasks are moved to "queued" in
// the database and handed to Inngest as task/execute events (lib/inngest/functions.ts), which sleeps
// until each task's time and then calls the step functions below.
//
// Every step re-reads the task and only writes while its run owns the current dispatch, so a
// retried step, a duplicate event or a run that lost the task can never run or save it twice.
//
// Agents with a computer each have their own sandbox in the campaign, so different agents work at the
// same time. A task takes its agent's lease before it starts (one task per agent at a time). Their
// runs can be long, so each Inngest step works for STEP_BUDGET_MS and then saves the run
// (checkpoint) for the next step to continue. A run that needs the user is saved too, and the task
// waits (waiting_for_user) until the user clicks "Done", or expires after WAIT_FOR_USER_MS.

// Inngest retries a failed step twice (three attempts); a review can send the work back once
export const TASK_RETRIES = 2;
const MAX_REVISIONS = 1;
// Hard stop for one step (the Inngest route allows 5 minutes); work is saved before it
const TASK_TIMEOUT_MS = 4.5 * 60 * 1000;
// After this long in one step, the next tool call saves the run and the next step carries on
const STEP_BUDGET_MS = 2.5 * 60 * 1000;
// A task waiting for the user expires after this long
export const WAIT_FOR_USER_MS = 24 * 60 * 60 * 1000;
// A repeating task stops after this many failed runs in a row
const MAX_CONSECUTIVE_FAILURES = 3;
// Upper bound on rounds of skipping tasks whose dependencies failed
const MAX_ROUNDS = 20;

const DONE_WITHOUT_SUCCESS: AgentTask["status"][] = ["failed", "cancelled", "expired"];

export type ExecuteEvent = ReturnType<typeof toExecuteEvent>;

// The event id makes Inngest drop a second send of the same dispatch
export function toExecuteEvent(task: DispatchedTask) {
  const dispatchId = `task-${task.id}-${task.queueSeq}`;
  return {
    id: dispatchId,
    name: "task/execute" as const,
    data: {
      dispatchId,
      taskId: task.id,
      planId: task.planId,
      userId: task.userId,
      campaignId: task.campaignId,
      agentId: task.agentId,
      queueSeq: task.queueSeq,
      scheduledAt: new Date(task.scheduledAt).toISOString(),
    },
  };
}

type Dispatch = { taskId: number; queueSeq: number };

// Queues tasks that are due within the next 15 minutes and sends their events right away. Called
// after the Master Agent plans, unblocks or retries work. Never throws, so it's safe in after().
export async function dispatchDueTasks(filter: Parameters<typeof queueDueTasks>[0] = {}) {
  try {
    const due = await queueDueTasks(filter);
    if (due.length === 0) return;
    try {
      await inngest.send(due.map(toExecuteEvent));
    } catch (error) {
      // Back to pending so the next cron run picks them up
      console.error("Sending task events failed", error);
      await Promise.all(due.map((task) => releaseQueuedTask(task.id, task.queueSeq)));
    }
  } catch (error) {
    console.error("Dispatching due tasks failed", error);
  }
}

// Picks up anything due for this campaign (when the workspace opens)
export async function resumePlans(scope: Scope) {
  await dispatchDueTasks({ scope });
}

async function getCampaignName(campaignId: number) {
  const [row] = await db.select({ name: campaigns.name }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  return row?.name ?? "your campaign";
}

function scopeOf(task: Pick<AgentTask, "userId" | "campaignId">): Scope {
  return { userId: task.userId, campaignId: task.campaignId };
}

// Each agent has its own computer in a campaign
function sandboxKey(task: Pick<AgentTask, "campaignId" | "agentId">) {
  return { campaignId: task.campaignId, agentId: task.agentId };
}

// Step 1, once the scheduled time has come: claim the dispatch for this run.
// "skip": the task was cancelled, rescheduled or already claimed elsewhere.
// "blocked": a dependency isn't done yet, so the task went back to pending.
// "busy": another agent is using the campaign's sandbox; try again shortly.
export async function startTaskRun({ taskId, queueSeq }: Dispatch, runId: string): Promise<"run" | "skip" | "blocked" | "busy"> {
  const task = await getTask(taskId);
  if (!task || task.queueSeq !== queueSeq) return "skip";

  if (task.status === "queued" && await getCampaignEndedAt(task.campaignId)) {
    await updateTask(task.id, { status: "cancelled", error: "The campaign has ended." }, ["queued"]);
    return "skip";
  }

  if (task.status === "queued" && task.dependsOn.length) {
    const tasks = await listPlanTasks(task.planId);
    const ready = task.dependsOn.every((id) => tasks.find((dep) => dep.id === id)?.status === "completed");
    if (!ready) {
      await releaseQueuedTask(task.id, queueSeq);
      return "blocked";
    }
  }

  if (getAgentDefinition(task.agentId).usesSandbox && !(await acquireSandboxLease(sandboxKey(task), task.id))) return "busy";
  return (await claimTask(taskId, queueSeq, runId)) ? "run" : "skip";
}

// Step 2 (and the revision): the worker agent does the task. Throws on failure so Inngest retries
// the step; the error is reported to the Master Agent on every attempt but the last.
// "continue": the step's time ran out and the run was saved; call again in a new step.
// "waiting": the task is waiting for the user (a question, or something to do in the sandbox).
export async function runTaskWork(taskId: number, runId: string, attempt: number): Promise<"done" | "continue" | "waiting" | "stopped"> {
  const task = await getTask(taskId);
  if (!task || task.runOwner !== runId || task.status !== "in_progress") return "stopped";
  const plan = await getPlan(task.planId);
  if (!plan) return "stopped";

  const [campaignName, tasks, artifacts, saved] = await Promise.all([
    getCampaignName(plan.campaignId),
    listPlanTasks(plan.id),
    describeDependencyArtifacts(task.dependsOn),
    describeDependencyWork(task.dependsOn),
  ]);
  const outputs = task.dependsOn
    .map((id) => tasks.find((dep) => dep.id === id))
    .filter((dep): dep is AgentTask => !!dep?.output)
    .map((dep) => `${getAgentRole(dep.agentId).name} — ${dep.title}:\n${clip(dep.output)}`)
    .join("\n\n");
  const inputs = [
    outputs,
    saved && `Research and drafts they saved (in the campaign's database):\n${saved}`,
    artifacts && `Files and links they made:\n${artifacts}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const scope = scopeOf(task);
  const definition = getAgentDefinition(task.agentId);
  const usesSandbox = definition.usesSandbox;
  const claimed = await updateOwnedTask(task.id, runId, { attempts: attempt + 1 }, ["in_progress"]);
  if (!claimed) return "stopped";
  if (usesSandbox) await renewSandboxLease(sandboxKey(task), task.id);

  // The time limit counts from when this go at the task started (a revision restarts the clock)
  const limit = claimed.revisions > 0 ? REVISION_TIME_LIMIT : definition.timeLimit;
  const startedAt = claimed.startedAt?.getTime() ?? Date.now();
  const deadlineAt = startedAt + limit.limitMs;

  const context: WorkerContext = {
    scope,
    campaignName,
    plan,
    // The saved run is passed on its own: the context is saved with the run, so keeping it here
    // would nest every earlier save inside the next one
    task: { ...claimed, runState: null },
    taskRunId: await getTaskRunId(task.id, task.queueSeq),
    inputs,
    questionsAsked: 0,
    waitingForUser: false,
    sandbox: usesSandbox ? new SandboxHandle(task.campaignId, task.agentId) : null,
    // A step also ends at the deadline, so the run comes back to finish with what it has
    checkpointAt: Math.min(Date.now() + STEP_BUDGET_MS, deadlineAt),
    wrapUpAt: startedAt + limit.wrapUpMs,
    deadlineAt,
    takeover: false,
    report: null,
  };

  try {
    const outcome = await withTimeout((signal) => runWorker(context, claimed.runState, signal), TASK_TIMEOUT_MS);
    const sandboxId = context.sandbox?.current?.sandboxId ?? task.sandboxId;

    switch (outcome.kind) {
      case "checkpoint": {
        const saved = await updateOwnedTask(task.id, runId, { runState: outcome.state, interruption: null, sandboxId }, ["in_progress"]);
        return saved ? "continue" : "stopped";
      }
      case "waiting":
        return await parkForUser(context, runId, outcome, sandboxId);
      case "question":
        // The worker asked the user something: the task stays parked until the answer re-queues it
        await finishTaskRun(task.id, task.queueSeq, { status: "cancelled", error: "Paused for the user's answer." });
        await releaseSandboxLease(sandboxKey(task), task.id);
        return "waiting";
      case "done": {
        if (!outcome.output) throw new Error("The agent finished without producing any work.");
        if (outcome.result) {
          await saveRunResult(task.id, task.queueSeq, outcome.result);
          await saveReportedArtifacts(context, outcome.result);
        }
        // Stops here if the plan was cancelled meanwhile
        const inReview = await updateOwnedTask(
          task.id,
          runId,
          { status: "in_review", output: outcome.output, runState: null, interruption: null, currentStep: null, sandboxId },
          ["in_progress"]
        );
        if (!inReview) return "stopped";
        await addCommunication(scope, { planId: plan.id, taskId: task.id, from: task.agentId, to: "master", kind: "result", text: clip(outcome.output) });
        return "done";
      }
    }
  } catch (error) {
    if (context.waitingForUser) return "waiting";
    const message = describeError(error);
    console.error(`Task ${task.id} failed (attempt ${attempt + 1})`, error);
    if (attempt < TASK_RETRIES) {
      await addCommunication(scope, {
        planId: plan.id,
        taskId: task.id,
        from: task.agentId,
        to: "master",
        kind: "error",
        text: `This attempt failed (${message}). Trying again.`,
      });
    }
    throw new Error(message);
  }
}

// The run needs the user in the sandbox: save it, mark the task waiting_for_user (it keeps the
// sandbox), pause the sandbox unless the user is using it, and tell the user in the Master chat.
async function parkForUser(
  context: WorkerContext,
  runId: string,
  outcome: Extract<WorkerOutcome, { kind: "waiting" }>,
  sandboxId: string | null
): Promise<"waiting" | "stopped"> {
  const { task, plan, scope } = context;
  const { interruption } = outcome;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + WAIT_FOR_USER_MS);
  const parked = await updateOwnedTask(
    task.id,
    runId,
    { status: "waiting_for_user", runState: outcome.state, interruption, waitingSince: now, expiresAt, currentStep: null, sandboxId, runOwner: null },
    ["in_progress"]
  );
  if (!parked) return "stopped";

  // This dispatch ends here; "Done" starts a new one that continues the saved run
  await finishTaskRun(task.id, task.queueSeq, { status: "cancelled", error: "Paused: waiting for the user." });
  await renewSandboxLease(sandboxKey(task), task.id, expiresAt);
  if (interruption.kind !== "takeover") {
    await pauseAgentSandbox(sandboxKey(task), context.sandbox?.current ?? undefined).catch((error) => console.error("Pausing the sandbox failed", error));
  }
  await updatePlan(plan.id, { status: "awaiting_user" }, ["in_progress"]);

  const name = getAgentRole(task.agentId).name;
  await addCommunication(scope, { planId: plan.id, taskId: task.id, from: task.agentId, to: "user", kind: "update", text: interruption.reason });
  if (interruption.kind !== "takeover") {
    const what = interruption.kind === "login" ? `to log in${interruption.platform ? ` to ${interruption.platform}` : ""}` : "to do something on the computer";
    await saveChatMessage(
      { ...scope, agentId: "master" },
      {
        sender: "agent",
        text: `The ${name} needs you ${what} for "${task.title}" (task #${task.id}):\n\n${interruption.reason}\n\nOpen the ${name} (in the office or its Computer tab) and click "Login now". You type your password into the computer yourself; the agent never sees it. Click "Done" when you're finished and it will carry on.`,
      }
    );
  }
  return "waiting";
}

// Step 3: the Master Agent reviews the work. "revise" sends it back for one more pass in this run.
export async function reviewTaskWork(taskId: number, runId: string): Promise<"approved" | "revise" | "stopped"> {
  const task = await getTask(taskId);
  if (!task || task.runOwner !== runId || task.status !== "in_review" || !task.output) return "stopped";
  const plan = await getPlan(task.planId);
  if (!plan) return "stopped";
  const campaignName = await getCampaignName(plan.campaignId);

  let review: { approved: boolean; feedback: string };
  try {
    review = await reviewTask({ plan, task, campaignName, output: task.output });
  } catch (error) {
    console.error("Master Agent review failed", error);
    review = { approved: true, feedback: "Accepted without a review (the review step failed)." };
  }
  await addCommunication(scopeOf(task), { planId: plan.id, taskId: task.id, from: "master", to: task.agentId, kind: "review", text: review.feedback });

  if (review.approved || task.revisions >= MAX_REVISIONS) {
    return (await updateOwnedTask(task.id, runId, { review: review.feedback }, ["in_review"])) ? "approved" : "stopped";
  }
  const revising = await updateOwnedTask(task.id, runId, { status: "in_progress", review: review.feedback, revisions: task.revisions + 1, startedAt: new Date() }, ["in_review"]);
  return revising ? "revise" : "stopped";
}

// The next run of a repeating task after the one that just ended, skipping any that were missed
// while it ran late. Null when the rule has run out.
function nextSchedule(task: AgentTask, runCount: number) {
  if (!task.repeat) return null;
  let next = task.nextRunAt;
  for (let i = 0; next && next.getTime() <= Date.now() && i < 1000; i++) next = nextOccurrence(task.repeat, next, runCount);
  if (!next) return null;
  return { scheduledAt: next, nextRunAt: nextOccurrence(task.repeat, next, runCount + 1) };
}

export function formatRunTime(date: Date, timeZone?: string) {
  // Spelled out field by field: Intl rejects dateStyle/timeStyle combined with timeZoneName
  return date.toLocaleString("en-US", {
    timeZone: timeZone ?? "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// Step 4: saves the result. A one-off task is completed; a repeating task goes back to pending at
// its next run time, or completes when its rule has run out.
export async function completeTaskRun(taskId: number, runId: string) {
  const task = await getTask(taskId);
  if (!task || task.runOwner !== runId || task.status !== "in_review") return;
  const runCount = task.runCount + 1;
  const next = nextSchedule(task, runCount);
  // The reviewed output, kept for good. Saved first and safe to repeat, so a retried step can't lose it.
  await saveAgentOutput(task);

  const saved = await updateOwnedTask(
    task.id,
    runId,
    next
      ? {
          status: "pending",
          scheduledAt: next.scheduledAt,
          nextRunAt: next.nextRunAt,
          runCount,
          consecutiveFailures: 0,
          revisions: 0,
          attempts: 0,
          error: null,
          runOwner: null,
          completedAt: new Date(),
        }
      : { status: "completed", nextRunAt: null, runCount, consecutiveFailures: 0, error: null, completedAt: new Date() },
    ["in_review"]
  );
  if (!saved) return;
  await releaseSandboxLease(sandboxKey(task), task.id);
  await finishTaskRun(task.id, task.queueSeq, { status: "completed", output: task.output });
  if (task.repeat) await reportRepeatRun(saved, `finished "${task.title}" (run ${runCount})`, task.output, next?.scheduledAt ?? null);
}

// The run failed after every retry (Inngest's onFailure). A one-off task fails; a repeating task
// moves on to its next run unless it has failed too many times in a row.
export async function failTaskRun({ taskId, queueSeq }: Dispatch, runId: string, message: string) {
  const task = await getTask(taskId);
  if (!task || task.queueSeq !== queueSeq) return null;

  // Failed before it was claimed: back to pending for the next cron run
  if (task.status === "queued") {
    await releaseQueuedTask(task.id, queueSeq);
    return task.planId;
  }
  if (task.runOwner !== runId || (task.status !== "in_progress" && task.status !== "in_review")) return null;

  const failures = task.consecutiveFailures + 1;
  const next = failures < MAX_CONSECUTIVE_FAILURES ? nextSchedule(task, task.runCount) : null;
  const saved = await updateOwnedTask(
    task.id,
    runId,
    {
      // A failed run starts over next time
      runState: null,
      interruption: null,
      currentStep: null,
      ...(next
        ? { status: "pending", scheduledAt: next.scheduledAt, nextRunAt: next.nextRunAt, consecutiveFailures: failures, revisions: 0, attempts: 0, error: message, runOwner: null }
        : { status: "failed", nextRunAt: null, consecutiveFailures: failures, error: message, completedAt: new Date() }),
    },
    ["in_progress", "in_review"]
  );
  if (!saved) return null;
  await releaseSandboxLease(sandboxKey(task), task.id);

  await finishTaskRun(task.id, queueSeq, { status: "failed", error: message });
  const text = next ? `This run failed: ${message} I'll try again at the next scheduled time.` : `I couldn't finish this task: ${message}`;
  await addCommunication(scopeOf(task), { planId: task.planId, taskId: task.id, from: task.agentId, to: "master", kind: "error", text });
  if (task.repeat) await reportRepeatRun(saved, `couldn't finish "${task.title}": ${message}`, null, next?.scheduledAt ?? null);
  return task.planId;
}

// Tasks left waiting for the user past their expiry: they expire (a repeating one moves on to its
// next run), give the sandbox back, and their plans settle. Returns events for newly due tasks.
export async function expireWaitingTasksAndAdvance(): Promise<ExecuteEvent[]> {
  const expired = await expireWaitingTasks();
  const planIds = new Set<number>();
  for (const task of expired) {
    planIds.add(task.planId);
    await releaseSandboxLease(sandboxKey(task), task.id);
    const next = nextSchedule(task, task.runCount);
    if (next) {
      await updateTask(task.id, { status: "pending", scheduledAt: next.scheduledAt, nextRunAt: next.nextRunAt, revisions: 0, attempts: 0, completedAt: null }, ["expired"]);
    }
    await addCommunication(scopeOf(task), {
      planId: task.planId,
      taskId: task.id,
      from: task.agentId,
      to: "master",
      kind: "error",
      text: next ? `Nobody picked this up in time. I'll try again at the next scheduled time.` : (task.error ?? "This task expired."),
    });
  }
  const events: ExecuteEvent[] = [];
  for (const planId of planIds) events.push(...(await advancePlan(planId)));
  return events;
}

// Later runs of a repeating task are reported in the Master Agent's chat once the plan itself is
// finished (until then, the plan's report covers them)
async function reportRepeatRun(task: AgentTask, what: string, output: string | null, nextRun: Date | null) {
  const plan = await getPlan(task.planId);
  if (!plan || ACTIVE_PLAN_STATUSES.includes(plan.status)) return;
  const lines = [`The ${getAgentRole(task.agentId).name} ${what}.`];
  if (output) lines.push(clip(output, 3000));
  lines.push(nextRun ? `Next run: ${formatRunTime(nextRun, task.repeat?.timeZone)}.` : "That was the last scheduled run.");
  await saveChatMessage({ ...scopeOf(task), agentId: "master" }, { sender: "agent", text: lines.join("\n\n") });
}

// Step 5, after any task ends: skips tasks whose dependencies failed, queues dependents that are now
// due (returning their events for the caller to send), and settles the plan if nothing is left.
export async function advancePlan(planId: number): Promise<ExecuteEvent[]> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const tasks = await listPlanTasks(planId);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const blocked = tasks.filter(
      (task) => task.status === "pending" && task.dependsOn.some((id) => DONE_WITHOUT_SUCCESS.includes(byId.get(id)?.status ?? "failed"))
    );
    if (blocked.length === 0) break;
    await Promise.all(
      blocked.map((task) => {
        const failedDep = task.dependsOn.map((id) => byId.get(id)).find((dep) => !dep || DONE_WITHOUT_SUCCESS.includes(dep.status));
        return updateTask(task.id, { status: "cancelled", error: `Skipped because "${failedDep?.title ?? "an earlier task"}" didn't finish.` }, ["pending"]);
      })
    );
  }

  const due = await queueDueTasks({ planIds: [planId] });
  const plan = await getPlan(planId);
  if (plan && ACTIVE_PLAN_STATUSES.includes(plan.status)) {
    await settlePlan(plan, await listPlanTasks(plan.id), await getCampaignName(plan.campaignId));
  }
  return due.map(toExecuteEvent);
}

// A task counts as done for its plan once it's completed, or (repeating) once its first run is in
const isDoneForPlan = (task: AgentTask) =>
  task.status === "completed" ||
  (!!task.repeat && task.runCount > 0 && !["failed", "cancelled", "expired", "awaiting_input", "waiting_for_user"].includes(task.status));

// Nothing left to run: finish the plan, mark it as waiting on the user, or report the failure.
// Each outcome is a conditional update, so only one run ever reports it.
async function settlePlan(plan: AgentPlan, tasks: AgentTask[], campaignName: string) {
  const scope: Scope = { userId: plan.userId, campaignId: plan.campaignId };
  const chat = { ...scope, agentId: "master" as const };

  // Still scheduled, queued or running somewhere
  const working: AgentTask["status"][] = ["pending", "queued", "in_progress", "in_review"];
  if (tasks.some((task) => !isDoneForPlan(task) && working.includes(task.status))) return;

  if (tasks.some((task) => task.status === "awaiting_input" || task.status === "waiting_for_user")) {
    await updatePlan(plan.id, { status: "awaiting_user" }, ["in_progress"]);
    return;
  }

  if (tasks.every(isDoneForPlan)) {
    const finished = await updatePlan(plan.id, { status: "completed", error: null, completedAt: new Date() }, ["in_progress", "awaiting_user"]);
    if (!finished) return;
    let summary: string;
    try {
      summary = await summarizePlan({ plan, tasks, campaignName });
    } catch (error) {
      console.error("Summarising plan failed", error);
      summary = `"${plan.title}" is done. Open the Tasks tab to see each teammate's work.`;
    }
    const repeating = tasks.filter((task) => task.repeat && task.status !== "completed");
    if (repeating.length) {
      const lines = repeating.map(
        (task) =>
          `- ${getAgentRole(task.agentId).name}, "${task.title}": ${describeRepeat(task.repeat!)}, next run ${formatRunTime(task.scheduledAt, task.repeat!.timeZone)}`
      );
      summary += `\n\nStill on repeat (I'll post each result here):\n${lines.join("\n")}`;
    }
    await updatePlan(plan.id, { summary });
    await addCommunication(scope, { planId: plan.id, from: "master", to: "user", kind: "result", text: summary });
    await saveChatMessage(chat, { sender: "agent", text: summary });
    return;
  }

  const failed = tasks.filter((task) => task.status === "failed" || task.status === "expired");
  const reason = failed.length
    ? failed.map((task) => `- ${getAgentRole(task.agentId).name}, "${task.title}": ${task.error ?? "it failed"}`).join("\n")
    : "- Some tasks were cancelled.";
  const ended = await updatePlan(plan.id, { status: "failed", error: reason, completedAt: new Date() }, ["in_progress", "awaiting_user"]);
  if (!ended) return;
  const done = tasks.filter(isDoneForPlan).length;
  const message = `I couldn't finish "${plan.title}" (${done} of ${tasks.length} tasks done):\n${reason}\n\nAsk me to retry the plan, or tell me what to change.`;
  await addCommunication(scope, { planId: plan.id, from: "master", to: "user", kind: "error", text: message });
  await saveChatMessage(chat, { sender: "agent", text: message });
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("The task took too long and was stopped.")), ms);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|took too long/i.test(message)) return "The task took too long and was stopped.";
  if (/rate limit|429/i.test(message)) return "The AI service is busy right now.";
  if (/max turns/i.test(message)) return "The agent ran out of steps before it finished. Try a smaller task, or retry.";
  return message.length > 300 ? `${message.slice(0, 300)}…` : message || "Something went wrong.";
}
