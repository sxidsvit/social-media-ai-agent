import "server-only";
import { getAgentRole, isWorkerRole, type WorkerRoleId } from "@/lib/agent-roles";
import { getCampaignEndedAt, setSandboxControl } from "@/lib/sandbox/agent-sandbox";
import { anchorRepeat, describeRepeat, nextOccurrence, RepeatRuleSchema } from "@/lib/orchestration/repeat";
import { formatRunTime } from "@/lib/orchestration/engine";
import type { RepeatRule } from "@/lib/orchestration/types";
import {
  addCommunication,
  createPlan,
  getScopedPlan,
  getScopedTask,
  listOpenQuestions,
  listPlanTasks,
  listWaitingTasks,
  updatePlan,
  updateTask,
  type NewPlanTask,
  type Scope,
} from "@/lib/orchestration/store";

// State changes the Master Agent makes on behalf of the user. Each returns { ok, message } where
// message is written for the Master Agent to read, and planId is set when the plan should be
// (re)started by the engine.
export type ControlResult = { ok: boolean; message: string; planId?: number };

export const MAX_PLAN_TASKS = 8;
// How far ahead a task can be scheduled
const MAX_SCHEDULE_DAYS = 90;

export type DraftTask = {
  key: string;
  agent: string;
  title: string;
  instructions: string;
  dependsOn: string[];
  // ISO time with an offset, or null to run now
  runAt: string | null;
  repeat: RepeatRule | null;
};

// Checks a drafted plan (unique keys, known agents, no missing or circular dependencies), orders the
// tasks so every dependency comes first, and saves it
export async function submitPlan(scope: Scope, draft: { title: string; request: string; tasks: DraftTask[] }): Promise<ControlResult> {
  const { tasks } = draft;
  if (await getCampaignEndedAt(scope.campaignId)) return { ok: false, message: "This campaign has ended, so no new work can be planned for it." };
  if (tasks.length === 0) return { ok: false, message: "A plan needs at least one task." };
  if (tasks.length > MAX_PLAN_TASKS) return { ok: false, message: `Keep plans to ${MAX_PLAN_TASKS} tasks or fewer.` };

  const byKey = new Map<string, DraftTask>();
  for (const task of tasks) {
    if (byKey.has(task.key)) return { ok: false, message: `Task key "${task.key}" is used twice. Keys must be unique.` };
    if (!isWorkerRole(task.agent)) return { ok: false, message: `"${task.agent}" is not a teammate you can assign work to.` };
    if (!task.title.trim() || !task.instructions.trim()) return { ok: false, message: `Task "${task.key}" needs a title and instructions.` };
    byKey.set(task.key, task);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (dep === task.key) return { ok: false, message: `Task "${task.key}" can't depend on itself.` };
      if (!byKey.has(dep)) return { ok: false, message: `Task "${task.key}" depends on "${dep}", which isn't in the plan.` };
      if (byKey.get(dep)!.repeat) {
        return { ok: false, message: `Task "${task.key}" can't depend on "${dep}" because it repeats. Only one-off tasks can be depended on.` };
      }
    }
  }

  // Run times: a past time means now, and nothing too far ahead
  const now = Date.now();
  const runAt = new Map<string, Date>();
  for (const task of tasks) {
    let time = new Date(now);
    if (task.runAt) {
      const parsed = new Date(task.runAt);
      if (Number.isNaN(parsed.getTime())) return { ok: false, message: `Task "${task.key}" has an invalid run_at time "${task.runAt}".` };
      if (parsed.getTime() > now + MAX_SCHEDULE_DAYS * 86_400_000) {
        return { ok: false, message: `Task "${task.key}" is scheduled too far ahead. Keep it within ${MAX_SCHEDULE_DAYS} days.` };
      }
      if (parsed.getTime() > now) time = parsed;
    }
    if (task.repeat) {
      const rule = RepeatRuleSchema.safeParse(task.repeat);
      if (!rule.success) return { ok: false, message: `Task "${task.key}" has an invalid repeat rule: ${rule.error.issues[0]?.message ?? "check it"}.` };
    }
    runAt.set(task.key, time);
  }

  // Depth-first topological sort; a key seen again while still on the stack means a cycle
  const ordered: DraftTask[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (task: DraftTask): string | null => {
    const seen = state.get(task.key);
    if (seen === "done") return null;
    if (seen === "visiting") return `The dependencies around task "${task.key}" form a loop.`;
    state.set(task.key, "visiting");
    for (const dep of task.dependsOn) {
      const error = visit(byKey.get(dep)!);
      if (error) return error;
    }
    state.set(task.key, "done");
    ordered.push(task);
    return null;
  };
  for (const task of tasks) {
    const error = visit(task);
    if (error) return { ok: false, message: error };
  }

  // A task never starts before the tasks it depends on (dependencies come first in `ordered`)
  for (const task of ordered) {
    for (const dep of task.dependsOn) {
      if (runAt.get(dep)! > runAt.get(task.key)!) runAt.set(task.key, runAt.get(dep)!);
    }
  }

  const index = new Map(ordered.map((task, i) => [task.key, i]));
  const newTasks: NewPlanTask[] = ordered.map((task) => {
    const scheduledAt = runAt.get(task.key)!;
    const repeat = task.repeat ? anchorRepeat(RepeatRuleSchema.parse(task.repeat) as RepeatRule, scheduledAt) : null;
    return {
      agentId: task.agent as WorkerRoleId,
      title: task.title.trim(),
      instructions: task.instructions.trim(),
      dependsOn: [...new Set(task.dependsOn)].map((dep) => index.get(dep)!),
      scheduledAt,
      repeat,
      nextRunAt: repeat ? nextOccurrence(repeat, scheduledAt, 1) : null,
    };
  });

  const { plan, tasks: saved } = await submitWithRetry(() => createPlan(scope, { title: draft.title.trim(), request: draft.request.trim(), tasks: newTasks }));
  const lines = saved.map((task) => `- #${task.id} ${getAgentRole(task.agentId).name}: ${task.title} (${describeSchedule(task)})`);
  return { ok: true, planId: plan.id, message: `Plan #${plan.id} "${plan.title}" was created and scheduled:\n${lines.join("\n")}` };
}

// "now", "Oct 14, 2026, 9:00 AM GMT+5:30" or "Oct 14, 2026, 9:00 AM GMT+5:30, then every week (…)"
export function describeSchedule(task: { scheduledAt: Date; repeat: RepeatRule | null; dependsOn: number[] }) {
  const soon = task.scheduledAt.getTime() <= Date.now() + 60_000;
  let text = soon ? (task.dependsOn.length ? "as soon as the tasks it needs are done" : "now") : formatRunTime(task.scheduledAt, task.repeat?.timeZone);
  if (task.repeat) text += `, then ${describeRepeat(task.repeat).replace(/^Every/, "every")}`;
  return text;
}

// One retry for a transient database error while saving
async function submitWithRetry<T>(save: () => Promise<T>) {
  try {
    return await save();
  } catch (error) {
    console.error("Saving plan failed, retrying", error);
    return save();
  }
}

// Passes the user's answer to a worker that's waiting on it, and queues its task again
export async function answerQuestion(scope: Scope, taskId: number, answer: string): Promise<ControlResult> {
  const task = await getScopedTask(scope, taskId);
  if (!task) return { ok: false, message: `There is no task #${taskId}.` };
  if (task.status !== "awaiting_input") return { ok: false, message: `Task #${taskId} isn't waiting for an answer.` };

  const requeued = await updateTask(task.id, { status: "pending", question: null }, ["awaiting_input"]);
  if (!requeued) return { ok: false, message: `Task #${taskId} isn't waiting for an answer any more.` };

  await addCommunication(scope, { planId: task.planId, taskId: task.id, from: "user", to: "master", kind: "clarification", text: answer });
  await addCommunication(scope, { planId: task.planId, taskId: task.id, from: "master", to: task.agentId, kind: "answer", text: answer });

  await resumePlanIfNobodyWaits(scope, task.planId);

  return { ok: true, planId: task.planId, message: `The answer was passed to the ${getAgentRole(task.agentId).name}, who will carry on with task #${task.id}.` };
}

// Heading that marks information added to a task after it was planned. The worker looks for it to
// tell whether its run has seen the latest instructions.
export const TASK_UPDATE_HEADING = "Added later by the user";

// Adds information the user gave after planning to an existing task, instead of planning it again.
// The task's instructions (and the plan's request, which teammates and reviews see) get the new
// details. Waiting or scheduled tasks start with them; a running task is told on its next turn
// (lib/orchestration/worker.ts). A finished one-off task is done again with the new details when
// `redo` is set, along with the finished tasks that build on it.
export async function updateTaskInstructions(scope: Scope, taskId: number, info: string, redo: boolean): Promise<ControlResult> {
  const task = await getScopedTask(scope, taskId);
  if (!task) return { ok: false, message: `There is no task #${taskId}.` };
  const plan = await getScopedPlan(scope, task.planId);
  if (!plan) return { ok: false, message: `There is no task #${taskId}.` };
  const text = info.trim();
  if (!text) return { ok: false, message: "Say what to add to the task." };
  if (plan.status === "cancelled") return { ok: false, message: `Task #${taskId}'s plan was cancelled. Plan the work again instead.` };

  const finished = task.status === "completed";
  if (finished && !redo) {
    return { ok: false, message: `Task #${taskId} is already done. Call update_task again with redo true to do it again with this information.` };
  }
  if (finished && task.repeat) return { ok: false, message: `Task #${taskId} has finished all its repeats. Plan the work again instead.` };

  await updateTask(task.id, { instructions: `${task.instructions}\n\n${TASK_UPDATE_HEADING}:\n${text}` });
  await updatePlan(plan.id, { request: `${plan.request}\n\n${TASK_UPDATE_HEADING} (for task #${task.id}):\n${text}` });
  await addCommunication(scope, { planId: plan.id, taskId: task.id, from: "master", to: task.agentId, kind: "update", text: `New information from the user: ${text}` });

  const name = getAgentRole(task.agentId).name;
  switch (task.status) {
    case "pending":
    case "queued":
      return { ok: true, planId: plan.id, message: `Task #${task.id} was updated; the ${name} will use the new information when it starts.` };
    case "in_progress":
    case "waiting_for_user":
      return { ok: true, message: `Task #${task.id} was updated; the ${name} is told while it works and will apply it.` };
    case "in_review":
      return { ok: true, message: `Task #${task.id} was updated; its review checks the work against the new information.` };
    case "awaiting_input":
      return { ok: true, message: `Task #${task.id} was updated. It's still waiting for the user to answer: ${task.question}` };
    case "failed":
    case "expired":
    case "cancelled":
      return { ok: true, message: `Task #${task.id} was updated, but it isn't running (${task.status}). Offer retry_plan to run it again.` };
    case "completed":
      break;
  }

  // Redo the finished task and the finished tasks downstream of it; each waits for its dependencies
  const tasks = await listPlanTasks(plan.id);
  const redone = new Set([task.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const other of tasks) {
      if (redone.has(other.id) || other.repeat || other.status !== "completed") continue;
      if (other.dependsOn.some((id) => redone.has(id))) {
        redone.add(other.id);
        grew = true;
      }
    }
  }
  const now = new Date();
  await Promise.all(
    [...redone].map((id) =>
      updateTask(id, { status: "pending", scheduledAt: now, attempts: 0, revisions: 0, error: null, review: null, runState: null, interruption: null, completedAt: null }, ["completed"])
    )
  );
  const downstream = tasks.filter((other) => other.id !== task.id && redone.has(other.id));
  for (const other of downstream) {
    await addCommunication(scope, {
      planId: plan.id,
      taskId: other.id,
      from: "master",
      to: other.agentId,
      kind: "update",
      text: `Redo this with the updated work from task #${task.id}.`,
    });
  }
  await updatePlan(plan.id, { status: "in_progress", error: null, completedAt: null });

  const also = downstream.length ? ` Tasks that build on it will be redone after it: ${downstream.map((other) => `#${other.id}`).join(", ")}.` : "";
  return { ok: true, planId: plan.id, message: `The ${name} will redo task #${task.id} with the new information.${also}` };
}

// The plan goes back to running once nobody else in it is waiting on the user
async function resumePlanIfNobodyWaits(scope: Scope, planId: number) {
  const [questions, waiting] = await Promise.all([listOpenQuestions(scope), listWaitingTasks(scope)]);
  const stillWaiting = [...questions, ...waiting].some((open) => open.planId === planId);
  if (!stillWaiting) await updatePlan(planId, { status: "in_progress" }, ["awaiting_user"]);
}

// The user is done in the sandbox (logged in, or handing it back after taking over): the saved run
// is queued again and continues from where it stopped. The task keeps the sandbox meanwhile.
export async function resumeTask(scope: Scope, taskId: number): Promise<ControlResult> {
  const task = await getScopedTask(scope, taskId);
  if (!task) return { ok: false, message: `There is no task #${taskId}.` };
  if (task.status !== "waiting_for_user") return { ok: false, message: `Task #${taskId} isn't waiting for you.` };

  await setSandboxControl({ campaignId: scope.campaignId, agentId: task.agentId }, "agent");
  const requeued = await updateTask(task.id, { status: "pending", scheduledAt: new Date(), waitingSince: null, expiresAt: null }, ["waiting_for_user"]);
  if (!requeued) return { ok: false, message: `Task #${taskId} isn't waiting for you any more.` };

  const done = task.interruption?.kind === "takeover" ? "handed the computer back" : "is done";
  await addCommunication(scope, { planId: task.planId, taskId: task.id, from: "user", to: task.agentId, kind: "update", text: `The user ${done}.` });
  await resumePlanIfNobodyWaits(scope, task.planId);
  return { ok: true, planId: task.planId, message: `The ${getAgentRole(task.agentId).name} is carrying on with task #${task.id}.` };
}

// Runs one failed or expired task again (from the start). In a plan that already ended, every
// unfinished task is retried, so the tasks that were skipped because of it run too.
export async function retryTask(scope: Scope, taskId: number): Promise<ControlResult> {
  const task = await getScopedTask(scope, taskId);
  if (!task) return { ok: false, message: `There is no task #${taskId}.` };
  if (task.status !== "failed" && task.status !== "expired" && task.status !== "cancelled") {
    return { ok: false, message: `Task #${taskId} is ${task.status.replace(/_/g, " ")}, so there's nothing to retry.` };
  }
  const plan = await getScopedPlan(scope, task.planId);
  if (plan && (plan.status === "failed" || plan.status === "cancelled")) return retryPlan(scope, plan.id);

  const retried = await updateTask(
    task.id,
    { status: "pending", attempts: 0, consecutiveFailures: 0, error: null, question: null, runState: null, interruption: null, scheduledAt: new Date() },
    ["failed", "expired", "cancelled"]
  );
  if (!retried) return { ok: false, message: `Task #${taskId} can't be retried right now.` };
  await addCommunication(scope, { planId: task.planId, taskId: task.id, from: "master", to: task.agentId, kind: "update", text: "Retrying this task." });
  return { ok: true, planId: task.planId, message: `Task #${taskId} is queued again.` };
}

// Stops a running plan, or the repeating tasks a finished plan still has scheduled
export async function cancelPlan(scope: Scope, planId: number): Promise<ControlResult> {
  const plan = await getScopedPlan(scope, planId);
  if (!plan) return { ok: false, message: `There is no plan #${planId}.` };

  const cancelled = await updatePlan(plan.id, { status: "cancelled", completedAt: new Date() }, ["in_progress", "awaiting_user"]);

  // Scheduled, queued and waiting tasks stop here (a queued task's Inngest run finds it cancelled and
  // exits); a task mid-run finishes its current step but its result isn't saved and nothing follows
  const tasks = await listPlanTasks(plan.id);
  const stopped = await Promise.all(
    tasks.map((task) =>
      updateTask(task.id, { status: "cancelled", question: null, nextRunAt: null, runState: null, interruption: null, error: "Cancelled by the user." }, [
        "pending",
        "queued",
        "awaiting_input",
        "waiting_for_user",
        ...(cancelled ? (["in_progress", "in_review"] as const) : []),
      ])
    )
  );
  if (cancelled) return { ok: true, message: `Plan #${planId} was cancelled.` };
  if (stopped.some(Boolean)) return { ok: true, message: `Plan #${planId}'s repeating tasks were stopped.` };
  return { ok: false, message: `Plan #${planId} has already finished (${plan.status}) and has nothing scheduled.` };
}

// Re-queues a plan's failed and skipped tasks and starts it again
export async function retryPlan(scope: Scope, planId: number): Promise<ControlResult> {
  const plan = await getScopedPlan(scope, planId);
  if (!plan) return { ok: false, message: `There is no plan #${planId}.` };
  if (plan.status !== "failed" && plan.status !== "cancelled") {
    return { ok: false, message: `Plan #${planId} is ${plan.status.replace("_", " ")}, so there's nothing to retry.` };
  }

  const tasks = await listPlanTasks(plan.id);
  const now = new Date();
  const retried = await Promise.all(
    tasks.map((task) => {
      // A repeating task runs now, then carries on with its rule from the first run time after now
      let nextRunAt = task.repeat ? (task.nextRunAt ?? task.scheduledAt) : null;
      for (let i = 0; task.repeat && nextRunAt && nextRunAt <= now && i < 1000; i++) nextRunAt = nextOccurrence(task.repeat, nextRunAt, task.runCount + 1);
      return updateTask(
        task.id,
        {
          status: "pending",
          attempts: 0,
          consecutiveFailures: 0,
          error: null,
          question: null,
          runState: null,
          interruption: null,
          scheduledAt: task.scheduledAt > now ? task.scheduledAt : now,
          nextRunAt,
        },
        ["failed", "cancelled", "expired"]
      );
    })
  );
  if (!retried.some(Boolean)) return { ok: false, message: `Plan #${planId} has no failed tasks to retry.` };

  await updatePlan(plan.id, { status: "in_progress", error: null, completedAt: null });
  await addCommunication(scope, { planId: plan.id, from: "master", to: "user", kind: "update", text: "Retrying the plan's unfinished tasks." });
  return { ok: true, planId: plan.id, message: `Plan #${planId} was restarted. Its failed and skipped tasks are queued again.` };
}
